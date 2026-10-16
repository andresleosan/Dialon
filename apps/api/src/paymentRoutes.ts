import {
  PAYMENT_PAGE,
  PAYMENT_REQUEST_STATUSES,
  RECEIPT_MAX_BYTES,
  RECEIPT_RETENTION_DAYS,
  RECEIPT_TYPES,
  isUid,
  isUuid,
  marketFor,
  parseCreatePaymentRequest,
  sniffReceipt,
  type PaymentRequestStatus,
  type ReceiptType,
} from "@dialon/contracts";
import type { TokenOutcome } from "./firebaseToken";
import { BodyError, guarded, readBoundedBytes } from "./http";
import { readJson } from "./jsonBody";
import {
  adminPaymentRequestView,
  createD1PaymentStore,
  paymentRequestView,
  receiptAvailable,
  type PaymentStore,
  type StoredPaymentRequest,
} from "./paymentStore";
import { baseHeaders, fail, respond, type Context } from "./respond";
import { d1From, type Store } from "./store";
import { expiredReceiptPage, retentionCursor, saveRetentionCursor } from "./retentionStore";

// Solicitudes por transferencia y comprobantes privados. Crear o subir NO activa nada: solo la aprobación manual del
// propietario. El comprobante vive en R2 privado (`PROOFS`) con una clave generada aquí; se descarga autenticado como
// adjunto y nunca hay URL pública. Su contenido nunca se analiza, se envía a una IA ni se registra.

const DAY_MS = 86_400_000;
const RETENTION_MS = RECEIPT_RETENTION_DAYS * DAY_MS;
const EXTENSIONS: Readonly<Record<ReceiptType, string>> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

type Verified = Extract<TokenOutcome, { ok: true }>;

export interface PaymentContext {
  readonly request: Request;
  readonly env: Env;
  readonly context: Context;
  readonly token: Verified;
  readonly store: Store;
  readonly payments?: PaymentStore;
  readonly signal: AbortSignal;
  readonly now: number;
  /** `ExecutionContext.waitUntil` del Worker: retiene el trabajo de fondo que debe terminar aunque se responda antes. */
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/** Bucket R2 privado si existe; sin él, las rutas de comprobantes responden 503. */
export function r2From(env: object): R2Bucket | undefined {
  if (!("PROOFS" in env)) return undefined;
  const bucket: unknown = (env as Record<string, unknown>).PROOFS;
  return typeof bucket === "object" && bucket !== null && typeof (bucket as { put?: unknown }).put === "function"
    ? (bucket as R2Bucket)
    : undefined;
}

function paymentsOf(ctx: PaymentContext): PaymentStore | undefined {
  if (ctx.payments) return ctx.payments;
  const db = d1From(ctx.env);
  return db ? createD1PaymentStore(db) : undefined;
}

function pageQuery(request: Request, max: number, fallback: number): { cursor: string | null; limit: number } | undefined {
  const query = new URL(request.url).searchParams;
  const cursor = query.get("cursor");
  const limitText = query.get("limit");
  const limit = limitText === null ? fallback : Number(limitText);
  if ((cursor !== null && !isUid(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > max) return undefined;
  return { cursor, limit };
}

/**
 * Descarga privada: adjunto, tipo seguro, nombre fijo generado, sin caché, sin interpretar ni incrustar. Pendiente: se
 * conserva durante la revisión; aprobada o rechazada: solo hasta subida + 90 días.
 */
async function receiptResponse(ctx: PaymentContext, stored: StoredPaymentRequest) {
  const { receiptKey: key, receiptType: type } = stored;
  if (key === null || type === null || !receiptAvailable(stored, ctx.now)) return fail(ctx.context, 410, "RECEIPT_EXPIRED");
  const bucket = r2From(ctx.env);
  if (!bucket) return fail(ctx.context, 503, "SERVICE_UNAVAILABLE");
  const object = await guarded(ctx.signal, () => bucket.get(key));
  if (!object) return fail(ctx.context, 410, "RECEIPT_EXPIRED");
  const headers = baseHeaders(ctx.context.cors);
  headers.set("Content-Type", type);
  headers.set("Content-Disposition", `attachment; filename="comprobante-${stored.id.slice(0, 8)}.${EXTENSIONS[type]}"`);
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

const MINE = /^\/v1\/me\/payment-requests(?:\/([^/]+)(\/receipt)?)?$/;
const ADMIN = /^\/v1\/admin\/payment-requests(?:\/([^/]+)(\/receipt|\/approve|\/reject)?)?$/;

export function isMinePaymentsPath(path: string): boolean {
  return MINE.test(path);
}

/** /v1/me/payment-requests[/:id/receipt] — el usuario autenticado, sobre lo suyo. */
export async function handleMinePayments(ctx: PaymentContext, path: string): Promise<Response> {
  const match = MINE.exec(path);
  const id = match?.[1];
  const receipt = match?.[2] !== undefined;
  const method = ctx.request.method;
  const payments = paymentsOf(ctx);
  if (!payments) return fail(ctx.context, 503, "SERVICE_UNAVAILABLE");
  const { context, token, now, signal } = ctx;

  if (id === undefined) {
    if (method === "GET") {
      const page = pageQuery(ctx.request, PAYMENT_PAGE.mineMax, PAYMENT_PAGE.mineDefault);
      if (!page) return fail(context, 400, "INVALID_REQUEST");
      const result = await guarded(signal, () => payments.listMine(token.uid, page.cursor, page.limit));
      return respond(context, 200, { requests: result.items.map((item) => paymentRequestView(item, now)), nextCursor: result.nextCursor });
    }
    if (method !== "POST") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "GET, POST, OPTIONS" } });
    return createRequest(ctx, payments);
  }

  if (!receipt || !isUuid(id)) return fail(context, 404, "INVALID_REQUEST");
  const stored = await guarded(signal, () => payments.get(id.toLowerCase()));
  // Otra persona o inexistente: 404 igual, sin revelar si existe.
  if (!stored || stored.uid !== token.uid) return fail(context, 404, "INVALID_REQUEST");
  if (method === "GET") return receiptResponse(ctx, stored);
  if (method !== "PUT") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "GET, PUT, OPTIONS" } });
  if (stored.status !== "pending" || stored.receiptUploadedAt !== null) return fail(context, 409, "CONFLICT");
  return uploadReceipt(ctx, payments, stored.id);
}

async function createRequest(ctx: PaymentContext, payments: PaymentStore): Promise<Response> {
  const { context, token, now, signal, store } = ctx;
  const body = await readJson(ctx.request, signal);
  if (!body.ok) return fail(context, body.status, body.code);
  const parsed = parseCreatePaymentRequest(body.value);
  if (!parsed.ok) return fail(context, 400, "INVALID_REQUEST");
  const { country, plan, idempotencyKey } = parsed.value;
  // Un reintento con la misma clave, país y plan devuelve lo ya creado aunque el propietario haya cambiado o
  // desactivado los pagos después: la disponibilidad actual solo decide sobre solicitudes NUEVAS.
  const previous = await guarded(signal, () => payments.findByKey(token.uid, idempotencyKey));
  if (previous) {
    return previous.plan === plan && previous.country === country
      ? respond(context, 200, paymentRequestView(previous, now))
      : fail(context, 409, "CONFLICT");
  }
  // Importe, moneda, duración y cuota los fija el servidor con la tarifa de ESE país; sin ella no hay solicitud (ni
  // tarifa de otro país como sustituto).
  const market = marketFor((await guarded(signal, () => store.getSettings())).payments, country);
  const amountMinor = market?.prices[plan] ?? null;
  const limits = market?.planLimits[plan] ?? null;
  if (!market || amountMinor === null || limits === null) return fail(context, 409, "PAYMENTS_DISABLED");
  // La solicitud necesita al usuario registrado (y su suscripción, que seguirá inactiva hasta la aprobación).
  const email = token.emailVerified === true && token.email ? token.email.toLowerCase() : null;
  await guarded(signal, () => store.touchUser(token.uid, email, now));
  const outcome = await guarded(signal, () =>
    payments.create(token.uid, { id: crypto.randomUUID(), country, plan, idempotencyKey, amountMinor, currency: market.currency, limits }, now),
  );
  if (!("request" in outcome)) return fail(context, 409, "CONFLICT");
  return respond(context, outcome.outcome === "created" ? 201 : 200, paymentRequestView(outcome.request, now));
}

async function uploadReceipt(ctx: PaymentContext, payments: PaymentStore, id: string): Promise<Response> {
  const { context, token, now, signal, request } = ctx;
  const declared = (request.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const type = RECEIPT_TYPES.find((candidate) => candidate === declared);
  if (!type) return fail(context, 415, "INVALID_REQUEST");
  if (Number(request.headers.get("Content-Length") ?? "0") > RECEIPT_MAX_BYTES) return fail(context, 413, "INVALID_REQUEST");
  const bucket = r2From(ctx.env);
  if (!bucket) return fail(context, 503, "SERVICE_UNAVAILABLE");

  let bytes: Uint8Array;
  try {
    // Tope real leyendo el stream: no se confía en Content-Length.
    bytes = await readBoundedBytes(request.body, RECEIPT_MAX_BYTES, signal);
  } catch (error) {
    if (error instanceof BodyError) return fail(context, 413, "INVALID_REQUEST");
    return fail(context, 504, "TIMEOUT");
  }
  // Vacío, HTML, SVG o un tipo declarado que no coincide con la firma real: rechazado.
  if (bytes.length === 0 || sniffReceipt(bytes) !== type) return fail(context, 400, "INVALID_REQUEST");

  // Clave única por intento, generada aquí (nunca el nombre ni una clave del cliente), con la fecha de subida delante
  // para que el barrido de retención recorra R2 en orden cronológico.
  const receipt = { key: receiptKey(now), type, bytes: bytes.length, uploadedAt: now, expiresAt: now + RETENTION_MS };
  // Una sola cadena put → asociar/reconciliar → limpiar, retenida con waitUntil: sigue aunque la respuesta salga antes
  // por cancelación o plazo (504). Cancelar no prueba que una escritura fallara, así que la cadena nunca se corta a medias.
  const chain = storeReceipt(bucket, payments, id, token.uid, bytes, receipt, signal);
  ctx.waitUntil(chain);
  let outcome: StoreOutcome;
  try {
    outcome = await guarded(signal, () => chain);
  } catch {
    return fail(context, 504, "TIMEOUT");
  }
  if (outcome === "conflict") return fail(context, 409, "CONFLICT");
  if (outcome !== "attached") return fail(context, outcome === "aborted" ? 504 : 503, outcome === "aborted" ? "TIMEOUT" : "SERVICE_UNAVAILABLE");
  const updated = await guarded(signal, () => payments.get(id));
  return updated ? respond(context, 201, paymentRequestView(updated, now)) : fail(context, 503, "SERVICE_UNAVAILABLE");
}

const KEY_PREFIX = "receipts/";
const KEY_PATTERN = /^receipts\/(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `receipts/<ms de subida, 13 dígitos>-<uuid>`: orden lexicográfico = orden cronológico. */
function receiptKey(now: number): string {
  return `${KEY_PREFIX}${String(now).padStart(13, "0")}-${crypto.randomUUID()}`;
}

type StoreOutcome = "attached" | "conflict" | "aborted" | "unavailable";
type NewReceipt = Parameters<PaymentStore["attachReceipt"]>[2];

/**
 * Nunca rechaza. Reglas: solo se borra un objeto que ESTE intento creó (put create-only confirmado) y que con certeza no
 * queda asociado. Si algo es incierto, el objeto se conserva y el barrido de retención lo borra a los 90 días si sigue
 * sin referencia en D1.
 */
async function storeReceipt(
  bucket: R2Bucket,
  payments: PaymentStore,
  id: string,
  uid: string,
  bytes: Uint8Array,
  receipt: NewReceipt,
  signal: AbortSignal,
): Promise<StoreOutcome> {
  const removeOwn = async () => {
    try {
      await bucket.delete(receipt.key);
    } catch {
      // Queda sin referencia: lo recoge el barrido de retención.
    }
  };

  if (signal.aborted) return "aborted";
  let created: boolean;
  try {
    // Solo crea: si la clave ya existiera, R2 no escribe y devuelve null.
    created = (await bucket.put(receipt.key, bytes, { httpMetadata: { contentType: receipt.type }, onlyIf: { etagDoesNotMatch: "*" } })) !== null;
  } catch {
    // No se sabe si se escribió: no se borra nada.
    return "unavailable";
  }
  // Colisión: el objeto existente no es de este intento; ni se asocia ni se borra.
  if (!created) return "unavailable";
  // Cancelado antes de asociar: no se asocia y se borra solo lo que este intento acaba de crear.
  const wasAborted = () => signal.aborted;
  if (wasAborted()) {
    await removeOwn();
    return "aborted";
  }

  let attached: boolean;
  try {
    attached = await payments.attachReceipt(id, uid, receipt);
  } catch {
    // Resultado incierto: se reconcilia leyendo la referencia. Solo se borra si ya es imposible que quede asociado
    // (la solicitud tiene otro comprobante o ya no está pendiente); si no se puede saber, se conserva.
    try {
      const current = await payments.get(id);
      if (current?.receiptKey === receipt.key) return "attached";
      if (current && (current.receiptKey !== null || current.receiptUploadedAt !== null || current.status !== "pending")) {
        await removeOwn();
        return "conflict";
      }
    } catch {
      // Sin poder comprobarlo: se conserva.
    }
    return "unavailable";
  }
  if (!attached) {
    // Otra subida ganó la carrera (o la solicitud ya no está pendiente): la condición no se cumplió, se borra lo propio.
    await removeOwn();
    return "conflict";
  }
  return "attached";
}

/** /v1/admin/payment-requests[/:id/(receipt|approve|reject)] — solo se llega aquí siendo propietario. */
export async function handleAdminPayments(ctx: PaymentContext, path: string): Promise<Response | undefined> {
  const match = ADMIN.exec(path);
  if (!match) return undefined;
  const { context, now, signal, token } = ctx;
  const payments = paymentsOf(ctx);
  if (!payments) return fail(context, 503, "SERVICE_UNAVAILABLE");
  const id = match[1];
  const action = match[2];
  const method = ctx.request.method;

  if (id === undefined) {
    if (method !== "GET") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "GET, OPTIONS" } });
    const page = pageQuery(ctx.request, PAYMENT_PAGE.adminMax, PAYMENT_PAGE.adminDefault);
    const statusText = new URL(ctx.request.url).searchParams.get("status");
    const status: PaymentRequestStatus | null | undefined =
      statusText === null ? null : PAYMENT_REQUEST_STATUSES.find((candidate) => candidate === statusText);
    if (!page || status === undefined) return fail(context, 400, "INVALID_REQUEST");
    const result = await guarded(signal, () => payments.listAll(status, page.cursor, page.limit));
    return respond(context, 200, { requests: result.items.map((item) => adminPaymentRequestView(item, now)), nextCursor: result.nextCursor });
  }
  if (action === undefined || !isUuid(id)) return fail(context, 404, "INVALID_REQUEST");
  const requestId = id.toLowerCase();

  if (action === "/receipt") {
    if (method !== "GET") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "GET, OPTIONS" } });
    const stored = await guarded(signal, () => payments.get(requestId));
    if (!stored) return fail(context, 404, "INVALID_REQUEST");
    return receiptResponse(ctx, stored);
  }

  if (method !== "POST") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "POST, OPTIONS" } });
  if (action === "/approve") {
    // Nonce del servidor por operación: solo la decisión que lo escribe aplica la renovación.
    const outcome = await guarded(signal, () => payments.approve(requestId, crypto.randomUUID(), now, token.uid));
    if (outcome === "missing") return fail(context, 404, "INVALID_REQUEST");
    if (outcome === "rejected" || outcome === "not_ready") return fail(context, 409, "CONFLICT");
  } else {
    const outcome = await guarded(signal, () => payments.reject(requestId, now, token.uid));
    if (outcome === "missing") return fail(context, 404, "INVALID_REQUEST");
    if (outcome === "approved") return fail(context, 409, "CONFLICT");
  }
  const updated = await guarded(signal, () => payments.get(requestId));
  return updated ? respond(context, 200, { request: adminPaymentRequestView(updated, now) }) : fail(context, 404, "INVALID_REQUEST");
}

/**
 * La purga es configuración del SERVIDOR, apagada por defecto: solo la cadena exacta "true" la autoriza. Ausente,
 * "false", el booleano `true` o cualquier otro valor la dejan apagada.
 */
function purgeEnabled(env: object): boolean {
  return (env as Record<string, unknown>).RECEIPT_PURGE_ENABLED === "true";
}

/** Clasifica un objeto de R2 para el barrido de huérfanos (claves en orden cronológico). */
function orphanCandidate(object: R2Object, cutoff: number): "stop" | "skip" | "check" {
  const match = KEY_PATTERN.exec(object.key);
  // Otro formato: no es de la app, nunca se toca.
  if (!match) return "skip";
  // Clave dentro de la retención: todo lo que sigue es más reciente.
  if (Number(match[1]) > cutoff) return "stop";
  return object.uploaded.getTime() > cutoff ? "skip" : "check";
}

/**
 * Limpieza de retención, reintentable: un fallo deja ese elemento para la siguiente ejecución y no corta el resto.
 * Conserva los metadatos mínimos de la decisión. Sin `RECEIPT_PURGE_ENABLED === "true"` no hace NADA (ni lecturas ni
 * escrituras). Solo local: no hay cron en el Worker real.
 * 1) Comprobantes de solicitudes APROBADAS o RECHAZADAS con más de 90 días desde la subida: borra en R2 y luego quita la
 *    referencia en D1 (solo si sigue apuntando al mismo objeto). Las pendientes nunca se purgan.
 * 2) Huérfanos (subidas interrumpidas o inciertas): objetos bajo `receipts/` con el formato de clave de la app, fecha de
 *    la clave Y fecha de subida de R2 anteriores a la retención, y sin referencia en D1. Nunca toca claves con otro
 *    formato ni objetos dentro de la retención.
 */
export async function cleanupExpiredReceipts(env: object, now: number, batch = 50, maxBatches = 20): Promise<number> {
  if (!purgeEnabled(env)) return 0;
  const db = d1From(env);
  const bucket = r2From(env);
  if (!db || !bucket) return 0;
  const payments = createD1PaymentStore(db);
  let removed = 0;
  try {
    let cursor = await retentionCursor(db, "receipts-db");
    for (let round = 0; round < maxBatches; round += 1) {
      const page = await expiredReceiptPage(db, now, batch, cursor);
      for (const { id, proof_key: key } of page.items) {
        try {
          await bucket.delete(key);
          await payments.forgetReceipt(id, key, now);
          removed += 1;
        } catch {
          // Este elemento queda para el siguiente recorrido completo; los posteriores sí se procesan.
        }
      }
      cursor = page.nextCursor;
      await saveRetentionCursor(db, "receipts-db", cursor, now);
      if (cursor === undefined) break;
    }
  } catch {
    // Sin D1 no se pueden comprobar referencias; se reintenta sin borrar datos a ciegas.
  }
  return removed + (await sweepOrphans(db, bucket, payments, now, maxBatches));
}

async function sweepOrphans(db: D1Database, bucket: R2Bucket, payments: PaymentStore, now: number, maxPages: number): Promise<number> {
  const cutoff = now - RETENTION_MS;
  let removed = 0;
  try {
    let cursor = await retentionCursor(db, "receipts-r2");
    for (let page = 0; page < maxPages; page += 1) {
      const listed = await bucket.list({ prefix: KEY_PREFIX, cursor, limit: 100 });
      for (const object of listed.objects) {
        const kind = orphanCandidate(object, cutoff);
        if (kind === "stop") {
          await saveRetentionCursor(db, "receipts-r2", undefined, now);
          return removed;
        }
        if (kind === "skip") continue;
        try {
          if (await payments.isReferenced(object.key)) continue;
          await bucket.delete(object.key);
          removed += 1;
        } catch {
          // No se detiene la página: un fallo no bloquea los objetos posteriores.
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
      await saveRetentionCursor(db, "receipts-r2", cursor, now);
      if (cursor === undefined) break;
    }
  } catch {
    // El cursor confirmado se conserva; una ejecución posterior continúa desde ahí.
  }
  return removed;
}

/** Solo contadores agregados: nunca claves, identificadores ni contenido. */
export interface ReceiptRetentionPreview {
  readonly expiredReceipts: number;
  readonly orphanReceipts: number;
  /** `true` si el presupuesto no alcanzó o alguna lectura falló: los contadores son un mínimo, no el total. */
  readonly hasMore: boolean;
}

/**
 * Previsualización de SOLO LECTURA de lo que purgaría `cleanupExpiredReceipts` en `now`, con el mismo criterio y
 * presupuesto acotado (`batch` filas por consulta, `maxBatches` consultas en D1 y páginas en R2). No depende de la
 * guarda, no borra, no olvida referencias y no lee ni escribe cursores: siempre empieza desde el principio. Si falta
 * almacenamiento o falla una lectura nunca dice «completo»: `hasMore: true`. Sin endpoint ni interfaz.
 */
export async function previewExpiredReceipts(env: object, now: number, batch = 50, maxBatches = 20): Promise<ReceiptRetentionPreview> {
  const db = d1From(env);
  const bucket = r2From(env);
  if (!db || !bucket) return { expiredReceipts: 0, orphanReceipts: 0, hasMore: true };
  let expiredReceipts = 0;
  let expiredComplete = false;
  try {
    let cursor: string | undefined;
    for (let round = 0; round < maxBatches; round += 1) {
      const page = await expiredReceiptPage(db, now, batch, cursor);
      expiredReceipts += page.items.length;
      cursor = page.nextCursor;
      if (cursor === undefined) {
        expiredComplete = true;
        break;
      }
    }
  } catch {
    // Lectura fallida: el recuento queda incompleto.
  }
  const orphans = await countOrphans(bucket, createD1PaymentStore(db), now, maxBatches);
  return { expiredReceipts, orphanReceipts: orphans.count, hasMore: !expiredComplete || !orphans.complete };
}

async function countOrphans(bucket: R2Bucket, payments: PaymentStore, now: number, maxPages: number): Promise<{ count: number; complete: boolean }> {
  const cutoff = now - RETENTION_MS;
  let count = 0;
  let cursor: string | undefined;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const listed = await bucket.list({ prefix: KEY_PREFIX, cursor, limit: 100 });
      for (const object of listed.objects) {
        const kind = orphanCandidate(object, cutoff);
        if (kind === "stop") return { count, complete: true };
        if (kind === "check" && !(await payments.isReferenced(object.key))) count += 1;
      }
      if (!listed.truncated) return { count, complete: true };
      cursor = listed.cursor;
    }
  } catch {
    // Lectura fallida: el recuento queda incompleto.
  }
  return { count, complete: false };
}

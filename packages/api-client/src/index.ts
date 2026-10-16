import {
  ADMIN_CAPS,
  DEFAULT_TEXT_TRANSLATION_LIMITS,
  PAYMENT_PAGE,
  PAYMENT_REQUEST_STATUSES,
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
  isUid,
  isUuid,
  parseAdminPaymentRequestsPage,
  parseAdminSettings,
  parseAdminStatus,
  parseAdminUsersPage,
  parseApiError,
  parseCreatePaymentRequest,
  parseMeResponse,
  parsePaymentRequestView,
  parsePaymentRequestsPage,
  parseSettingsUpdate,
  parseSubscriptionUpdate,
  parseTextTranslationRequest,
  parseTextTranslationResult,
  sniffReceipt,
  type AdminPaymentRequestView,
  type AdminSettings,
  type AdminStatus,
  type AdminUsersPage,
  type CreatePaymentRequest,
  type ErrorCode,
  type Limits,
  type MeResponse,
  type ParseResult,
  type PaymentRequestStatus,
  type PaymentRequestView,
  type PaymentRequestsPage,
  type ReceiptType,
  type SettingsUpdate,
  type SubscriptionUpdate,
  type SubscriptionView,
  type TextTranslationRequest,
  type TextTranslationResult,
} from "@dialon/contracts";

// Cliente portable (sin DOM ni Expo) del API de Dialon. El token lo da quien lo usa, en cada llamada; aquí nunca se
// guarda, se cachea ni se registra, y nunca va en la URL. Sin reintentos: cada intento puede costar inferencia. El rol
// de propietario lo decide SOLO el backend (`getMe().role`); el cliente nunca lo deduce del email.

const TRANSLATE_ROUTE = "/v1/translate";
const DEFAULT_TIMEOUT_MS = 35_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Tope de bytes de respuesta por ruta, acotado por el esquema: 16 KiB para traducción y respuestas pequeñas; las
 * páginas admin pueden ser legalmente más grandes (50 usuarios con email y uid máximos, con escapes UTF-8). La cuenta y
 * los ajustes llevan el catálogo de hasta 20 países con sus instrucciones: 128 KiB.
 */
export const RESPONSE_BUDGET = {
  small: 16 * 1024,
  account: 128 * 1024,
  myRequests: 64 * 1024,
  adminRequests: 192 * 1024,
  usersPage: 256 * 1024,
  receipt: RECEIPT_MAX_BYTES,
} as const;

// Mensajes fijos por código: nunca se repite un mensaje remoto.
const DETAIL: Readonly<Partial<Record<ErrorCode, string>>> = {
  INVALID_REQUEST: "petición inválida",
  UNSUPPORTED_LANGUAGE: "idioma no admitido",
  UNAUTHENTICATED: "sin sesión válida",
  TOKEN_EXPIRED: "sesión caducada",
  FORBIDDEN: "no permitido",
  RATE_LIMITED: "demasiadas peticiones",
  SUBSCRIPTION_REQUIRED: "sin suscripción activa",
  QUOTA_EXCEEDED: "cuota del periodo agotada",
  CONSENT_REQUIRED: "falta el consentimiento para el proveedor externo",
  CONFLICT: "la operación no es compatible con el estado actual",
  PAYMENTS_DISABLED: "los pagos por transferencia no están disponibles",
  RECEIPT_EXPIRED: "el comprobante ya no está disponible",
  BUSY: "traductor ocupado",
  SERVICE_UNAVAILABLE: "servicio no disponible",
  TIMEOUT: "tiempo agotado",
  INTERNAL: "error interno",
  NETWORK: "sin conexión",
  INVALID_RESPONSE: "respuesta inválida",
};

/**
 * Requisito: `fetch` debe devolver un `Response` con `body` legible (ReadableStream con `getReader`), como fetch en
 * navegadores, Node y Workers. Si no, toda respuesta es `INVALID_RESPONSE`: no se descarga sin tope.
 */
export interface ApiClientOptions {
  /** `https://…`, o `http://` solo en loopback para desarrollo. Sin credenciales en la URL. */
  readonly baseUrl: string;
  /** Firebase ID token vigente o `null`. Se pide en cada llamada. */
  readonly getIdToken: (signal: AbortSignal) => Promise<string | null>;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Catálogo de idiomas; por defecto el compartido de seis. */
  readonly limits?: Limits;
  /** Plazo propio total (token, fetch y lectura). Por defecto 35 s. */
  readonly timeoutMs?: number;
}

export interface ReceiptFile {
  readonly data: Blob | Uint8Array;
  readonly type: ReceiptType;
}

export interface DownloadedReceipt {
  readonly bytes: Uint8Array;
  readonly type: ReceiptType;
  /** Nombre fijo generado aquí (nunca el del archivo original). */
  readonly filename: string;
}

/**
 * En todos los métodos: si `signal` se cancela en cualquier momento, rechazan con `AbortError` y nunca entregan un
 * resultado; si vence el plazo propio, resuelven con `TIMEOUT`. Los errores del servidor llegan por código con un
 * mensaje fijo, nunca con el mensaje remoto.
 */
export interface ApiClient {
  /** Traduce texto (sin audio). */
  translateText(request: TextTranslationRequest, signal?: AbortSignal): Promise<ParseResult<TextTranslationResult>>;
  /** Cuenta propia: rol (según el backend), suscripción con la cuota del periodo y pagos públicos. */
  getMe(signal?: AbortSignal): Promise<ParseResult<MeResponse>>;
  /** Solo propietario: usuarios paginados (25 por defecto, 50 como máximo). */
  listUsers(page?: { readonly cursor?: string; readonly limit?: number }, signal?: AbortSignal): Promise<ParseResult<AdminUsersPage>>;
  /** Solo propietario: activa, renueva, suspende o desactiva la suscripción manual de un usuario. */
  updateSubscription(
    uid: string,
    update: SubscriptionUpdate,
    signal?: AbortSignal,
  ): Promise<ParseResult<{ readonly uid: string; readonly subscription: SubscriptionView }>>;
  getSettings(signal?: AbortSignal): Promise<ParseResult<AdminSettings>>;
  updateSettings(update: SettingsUpdate, signal?: AbortSignal): Promise<ParseResult<AdminSettings>>;
  /** Solo propietario: estado de proveedores sin que el servidor haga ninguna petición a ellos. */
  getStatus(signal?: AbortSignal): Promise<ParseResult<AdminStatus>>;
  /** Solicitudes propias (10 por defecto, 20 como máximo). */
  listMyPaymentRequests(
    page?: { readonly cursor?: string; readonly limit?: number },
    signal?: AbortSignal,
  ): Promise<ParseResult<PaymentRequestsPage>>;
  /** Crea (o repite, con la misma clave) una solicitud. No activa nada: solo la aprobación manual. */
  createPaymentRequest(request: CreatePaymentRequest, signal?: AbortSignal): Promise<ParseResult<PaymentRequestView>>;
  /** Sube el comprobante (PDF, PNG o JPEG, ≤ 5 MiB) en binario. Uno por solicitud, sin sustituciones. */
  uploadReceipt(id: string, file: ReceiptFile, signal?: AbortSignal): Promise<ParseResult<PaymentRequestView>>;
  downloadMyReceipt(id: string, signal?: AbortSignal): Promise<ParseResult<DownloadedReceipt>>;
  /** Solo propietario. */
  listPaymentRequests(
    page?: { readonly status?: PaymentRequestStatus; readonly cursor?: string; readonly limit?: number },
    signal?: AbortSignal,
  ): Promise<ParseResult<PaymentRequestsPage<AdminPaymentRequestView>>>;
  downloadReceiptAsOwner(id: string, signal?: AbortSignal): Promise<ParseResult<DownloadedReceipt>>;
  approvePaymentRequest(id: string, signal?: AbortSignal): Promise<ParseResult<AdminPaymentRequestView>>;
  rejectPaymentRequest(id: string, signal?: AbortSignal): Promise<ParseResult<AdminPaymentRequestView>>;
}

type Sent<T> =
  | { readonly ok: true; readonly status: number; readonly headers: Headers; readonly value: T }
  | { readonly ok: false; readonly result: ParseResult<never> };

function failure(code: ErrorCode): ParseResult<never> {
  return { ok: false, code, detail: DETAIL[code] ?? "error" };
}

function abortError(): DOMException {
  return new DOMException("Petición cancelada", "AbortError");
}

function baseOf(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl no es una URL válida");
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure || url.username !== "" || url.password !== "") {
    throw new TypeError("baseUrl debe ser https (o http de loopback) y sin credenciales");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Espera `promise` pero rechaza en cuanto `signal` se cancela: ningún await queda colgado. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("fallo"));
      },
    );
  });
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === "object" && value !== null && typeof (value as { getReader?: unknown }).getReader === "function";
}

/**
 * Bytes del cuerpo con tope, leídos trozo a trozo del stream; `undefined` si se pasa o si no hay un `Response.body`
 * legible. Sin stream no hay lectura alternativa (`text()`, `json()`…) ni se confía en `Content-Length`: el tope solo se
 * puede imponer leyendo el stream. Un adaptador de fetch sin streaming (p. ej. nativo) necesitaría su propio adaptador
 * con un límite real, que no existe todavía.
 */
async function boundedBytes(response: Response, signal: AbortSignal, maxBytes: number): Promise<Uint8Array | undefined> {
  const body: unknown = response.body;
  if (!isReadableStream(body)) return undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await untilAborted(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function boundedJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  const bytes = await boundedBytes(response, signal, maxBytes);
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Error del servidor por código conocido, con mensaje fijo; cualquier otra cosa es `INVALID_RESPONSE`. */
function remoteFailure(payload: unknown): ParseResult<never> {
  const remote = parseApiError(payload);
  return failure(remote.ok ? remote.value.code : "INVALID_RESPONSE");
}

function parseSubscriptionReply(
  payload: unknown,
  uid: string,
): ParseResult<{ readonly uid: string; readonly subscription: SubscriptionView }> {
  if (typeof payload !== "object" || payload === null) return failure("INVALID_RESPONSE");
  const record = payload as Record<string, unknown>;
  // Reutiliza el parser de la cuenta para validar la vista de suscripción, con datos de relleno neutros.
  const view = parseMeResponse({
    uid,
    role: "user",
    subscription: record.subscription,
    payments: { enabled: false, markets: [] },
  });
  if (record.uid !== uid || !view.ok) return failure("INVALID_RESPONSE");
  return { ok: true, value: { uid, subscription: view.value.subscription } };
}

function parseDecision(payload: unknown): ParseResult<AdminPaymentRequestView> {
  if (typeof payload !== "object" || payload === null) return failure("INVALID_RESPONSE");
  const page = parseAdminPaymentRequestsPage({ requests: [(payload as Record<string, unknown>).request], nextCursor: null });
  const request = page.ok ? page.value.requests[0] : undefined;
  return request ? { ok: true, value: request } : failure("INVALID_RESPONSE");
}

const EXTENSIONS: Readonly<Record<ReceiptType, string>> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

function pageQuery(page: { readonly cursor?: string; readonly limit?: number }, fallback: number, max: number, extra: Record<string, string> = {}) {
  const { cursor, limit = fallback } = page;
  if ((cursor !== undefined && !isUid(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > max) return undefined;
  const query = new URLSearchParams({ ...extra, limit: String(limit) });
  if (cursor !== undefined) query.set("cursor", cursor);
  return query.toString();
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = baseOf(options.baseUrl);
  const limits = options.limits ?? DEFAULT_TEXT_TRANSLATION_LIMITS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));

  /**
   * Una petición autenticada: token pedido en el momento (sin caché), `redirect: "error"`, respuesta leída por `read`
   * con su tope y bajo el plazo propio. Cancelación del usuario → `AbortError`; plazo propio → `TIMEOUT`.
   */
  async function send<T>(
    method: "GET" | "POST" | "PUT",
    route: string,
    body: { readonly data: BodyInit; readonly type: string } | undefined,
    read: (response: Response, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Sent<T>> {
    if (signal?.aborted) throw abortError();
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const stopped = (fallback: ErrorCode): Sent<T> => {
      if (signal?.aborted) throw abortError();
      return { ok: false, result: failure(deadline.aborted ? "TIMEOUT" : fallback) };
    };

    let token: string | null;
    try {
      token = await untilAborted(options.getIdToken(combined), combined);
    } catch {
      return stopped("UNAUTHENTICATED");
    }
    if (token === null || token === "") return { ok: false, result: failure("UNAUTHENTICATED") };

    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = body.type;
    let response: Response;
    try {
      response = await untilAborted(
        fetchFn(`${base}${route}`, { method, headers, body: body?.data, redirect: "error", signal: combined }),
        combined,
      );
    } catch {
      return stopped("NETWORK");
    }

    let value: T;
    try {
      value = await read(response, combined);
    } catch {
      return stopped("NETWORK");
    }
    if (signal?.aborted) throw abortError();
    return { ok: true, status: response.status, headers: response.headers, value };
  }

  /** JSON con tope por ruta; acepta solo los estados de éxito indicados y valida con `parse`. */
  async function call<T>(
    method: "GET" | "POST" | "PUT",
    route: string,
    body: unknown,
    budget: number,
    parse: (payload: unknown) => ParseResult<T>,
    signal?: AbortSignal,
    okStatuses: readonly number[] = [200],
  ): Promise<ParseResult<T>> {
    const json = body === undefined ? undefined : { data: JSON.stringify(body), type: "application/json" };
    const result = await send(method, route, json, (response, combined) => boundedJson(response, combined, budget), signal);
    if (!result.ok) return result.result;
    if (!okStatuses.includes(result.status)) return remoteFailure(result.value);
    const parsed = parse(result.value);
    return parsed.ok ? parsed : failure("INVALID_RESPONSE");
  }

  /** Descarga del comprobante: tope de 5 MiB, tipo de la lista y firma real coherente con el tipo. */
  async function download(route: string, id: string, signal?: AbortSignal): Promise<ParseResult<DownloadedReceipt>> {
    if (signal?.aborted) throw abortError();
    if (!isUuid(id)) return failure("INVALID_REQUEST");
    const result = await send(
      "GET",
      route,
      undefined,
      async (response, combined) =>
        response.status === 200
          ? { bytes: await boundedBytes(response, combined, RESPONSE_BUDGET.receipt), payload: undefined }
          : { bytes: undefined, payload: await boundedJson(response, combined, RESPONSE_BUDGET.small) },
      signal,
    );
    if (!result.ok) return result.result;
    if (result.status !== 200) return remoteFailure(result.value.payload);
    const declared = (result.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase();
    const type = RECEIPT_TYPES.find((candidate) => candidate === declared);
    const { bytes } = result.value;
    if (!type || !bytes || bytes.length === 0 || sniffReceipt(bytes) !== type) return failure("INVALID_RESPONSE");
    return { ok: true, value: { bytes, type, filename: `comprobante-${id.slice(0, 8)}.${EXTENSIONS[type]}` } };
  }

  async function translateText(
    request: TextTranslationRequest,
    signal?: AbortSignal,
  ): Promise<ParseResult<TextTranslationResult>> {
    if (signal?.aborted) throw abortError();
    const parsed = parseTextTranslationRequest(request, limits);
    if (!parsed.ok) return failure(parsed.code === "UNSUPPORTED_LANGUAGE" ? "UNSUPPORTED_LANGUAGE" : "INVALID_REQUEST");
    const result = await call(
      "POST",
      TRANSLATE_ROUTE,
      parsed.value,
      RESPONSE_BUDGET.small,
      (payload) => parseTextTranslationResult(payload, limits),
      signal,
    );
    if (result.ok && result.value.requestId !== parsed.value.requestId) return failure("INVALID_RESPONSE");
    return result;
  }

  return {
    translateText,

    getMe: (signal) => call("GET", "/v1/me", undefined, RESPONSE_BUDGET.account, parseMeResponse, signal),

    listUsers(page = {}, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      const query = pageQuery(page, ADMIN_CAPS.defaultUsersPage, ADMIN_CAPS.maxUsersPage);
      if (query === undefined) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("GET", `/v1/admin/users?${query}`, undefined, RESPONSE_BUDGET.usersPage, parseAdminUsersPage, signal);
    },

    updateSubscription(uid, update, signal) {
      const parsed = parseSubscriptionUpdate(update, Date.now());
      if (!isUid(uid) || !parsed.ok) return Promise.resolve(failure("INVALID_REQUEST"));
      return call(
        "PUT",
        `/v1/admin/users/${uid}/subscription`,
        parsed.value,
        RESPONSE_BUDGET.small,
        (payload) => parseSubscriptionReply(payload, uid),
        signal,
      );
    },

    getSettings: (signal) => call("GET", "/v1/admin/settings", undefined, RESPONSE_BUDGET.account, parseAdminSettings, signal),

    updateSettings(update, signal) {
      const parsed = parseSettingsUpdate(update);
      if (!parsed.ok) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("PUT", "/v1/admin/settings", parsed.value, RESPONSE_BUDGET.account, parseAdminSettings, signal);
    },

    getStatus: (signal) => call("GET", "/v1/admin/status", undefined, RESPONSE_BUDGET.small, parseAdminStatus, signal),

    listMyPaymentRequests(page = {}, signal) {
      const query = pageQuery(page, PAYMENT_PAGE.mineDefault, PAYMENT_PAGE.mineMax);
      if (query === undefined) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("GET", `/v1/me/payment-requests?${query}`, undefined, RESPONSE_BUDGET.myRequests, parsePaymentRequestsPage, signal);
    },

    createPaymentRequest(request, signal) {
      const parsed = parseCreatePaymentRequest(request);
      if (!parsed.ok) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("POST", "/v1/me/payment-requests", parsed.value, RESPONSE_BUDGET.small, parsePaymentRequestView, signal, [200, 201]);
    },

    async uploadReceipt(id, file, signal) {
      if (signal?.aborted) throw abortError();
      const size = file.data instanceof Uint8Array ? file.data.byteLength : file.data.size;
      if (!isUuid(id) || !RECEIPT_TYPES.includes(file.type) || size === 0 || size > RECEIPT_MAX_BYTES) {
        return failure("INVALID_REQUEST");
      }
      const result = await send(
        "PUT",
        `/v1/me/payment-requests/${id}/receipt`,
        { data: file.data as BodyInit, type: file.type },
        (response, combined) => boundedJson(response, combined, RESPONSE_BUDGET.small),
        signal,
      );
      if (!result.ok) return result.result;
      if (result.status !== 201) return remoteFailure(result.value);
      const parsed = parsePaymentRequestView(result.value);
      return parsed.ok ? parsed : failure("INVALID_RESPONSE");
    },

    downloadMyReceipt: (id, signal) => download(`/v1/me/payment-requests/${id}/receipt`, id, signal),

    listPaymentRequests(page = {}, signal) {
      const { status } = page;
      if (status !== undefined && !PAYMENT_REQUEST_STATUSES.includes(status)) return Promise.resolve(failure("INVALID_REQUEST"));
      const query = pageQuery(page, PAYMENT_PAGE.adminDefault, PAYMENT_PAGE.adminMax, status === undefined ? {} : { status });
      if (query === undefined) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("GET", `/v1/admin/payment-requests?${query}`, undefined, RESPONSE_BUDGET.adminRequests, parseAdminPaymentRequestsPage, signal);
    },

    downloadReceiptAsOwner: (id, signal) => download(`/v1/admin/payment-requests/${id}/receipt`, id, signal),

    approvePaymentRequest(id, signal) {
      if (!isUuid(id)) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("POST", `/v1/admin/payment-requests/${id}/approve`, undefined, RESPONSE_BUDGET.small, parseDecision, signal);
    },

    rejectPaymentRequest(id, signal) {
      if (!isUuid(id)) return Promise.resolve(failure("INVALID_REQUEST"));
      return call("POST", `/v1/admin/payment-requests/${id}/reject`, undefined, RESPONSE_BUDGET.small, parseDecision, signal);
    },
  };
}

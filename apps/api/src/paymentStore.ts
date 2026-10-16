import {
  ADMIN_CAPS,
  PAYMENT_PLAN_DAYS,
  PAYMENT_REQUEST_STATUSES,
  RECEIPT_TYPES,
  type AdminPaymentRequestView,
  type PaymentPlan,
  type PaymentRequestStatus,
  type PaymentRequestView,
  type ReceiptType,
  type SubscriptionLimits,
} from "@dialon/contracts";

// Solicitudes por transferencia en D1. Todo cambio de estado es CONDICIONAL y atómico en la base: nunca se confía en
// haber leído «pendiente» antes de escribir. No se guarda nada del contenido del comprobante (solo tipo, tamaño,
// fechas y la clave privada del objeto en R2) ni datos bancarios.

const DAY_MS = 86_400_000;
const PAYMENT_PLANS = Object.keys(PAYMENT_PLAN_DAYS) as PaymentPlan[];

export interface StoredPaymentRequest {
  readonly id: string;
  /** País congelado al crear; `null` solo en solicitudes anteriores a 0004. */
  readonly country: string | null;
  readonly uid: string;
  readonly email: string | null;
  readonly plan: PaymentPlan;
  readonly days: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly limits: SubscriptionLimits;
  readonly status: PaymentRequestStatus;
  readonly createdAt: number;
  readonly decidedAt: number | null;
  readonly receiptKey: string | null;
  readonly receiptType: ReceiptType | null;
  readonly receiptBytes: number | null;
  readonly receiptUploadedAt: number | null;
  readonly receiptExpiresAt: number | null;
}

export interface NewPaymentRequest {
  readonly id: string;
  readonly country: string;
  readonly plan: PaymentPlan;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly limits: SubscriptionLimits;
}

export type CreateOutcome =
  | { readonly outcome: "created" | "existing"; readonly request: StoredPaymentRequest }
  | { readonly outcome: "mismatch" | "pending_exists" };

export type ApproveOutcome = "approved" | "already_approved" | "rejected" | "not_ready" | "missing";
export type RejectOutcome = "rejected" | "already_rejected" | "approved" | "missing";

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export interface PaymentStore {
  readonly create: (uid: string, request: NewPaymentRequest, now: number) => Promise<CreateOutcome>;
  readonly get: (id: string) => Promise<StoredPaymentRequest | null>;
  /** Solicitud del usuario con esa clave de idempotencia, si existe. */
  readonly findByKey: (uid: string, idempotencyKey: string) => Promise<StoredPaymentRequest | null>;
  readonly listMine: (uid: string, cursor: string | null, limit: number) => Promise<Page<StoredPaymentRequest>>;
  readonly listAll: (status: PaymentRequestStatus | null, cursor: string | null, limit: number) => Promise<Page<StoredPaymentRequest>>;
  /** Asocia el comprobante solo si la solicitud es del usuario, sigue pendiente y no tenía ninguno. */
  readonly attachReceipt: (
    id: string,
    uid: string,
    receipt: { readonly key: string; readonly type: ReceiptType; readonly bytes: number; readonly uploadedAt: number; readonly expiresAt: number },
  ) => Promise<boolean>;
  readonly approve: (id: string, nonce: string, now: number, actorUid: string) => Promise<ApproveOutcome>;
  readonly reject: (id: string, now: number, actorUid: string) => Promise<RejectOutcome>;
  readonly expiredReceipts: (now: number, limit: number) => Promise<{ readonly id: string; readonly key: string }[]>;
  /** Quita la referencia solo si sigue apuntando a ese objeto (reintentable). */
  readonly forgetReceipt: (id: string, key: string, now: number) => Promise<void>;
  /** ¿Alguna solicitud referencia este objeto? (barrido de huérfanos) */
  readonly isReferenced: (key: string) => Promise<boolean>;
}

type Row = Record<string, unknown>;

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function requestFrom(row: Row): StoredPaymentRequest | undefined {
  const plan = PAYMENT_PLANS.find((candidate) => candidate === row.plan);
  const status = PAYMENT_REQUEST_STATUSES.find((candidate) => candidate === row.status);
  const amountMinor = int(row.amount_minor);
  const maxRequests = int(row.max_requests);
  const maxChars = int(row.max_chars);
  const createdAt = int(row.created_at);
  if (typeof row.id !== "string" || typeof row.uid !== "string" || !plan || !status || typeof row.currency !== "string") return undefined;
  if (amountMinor === null || maxRequests === null || maxChars === null || createdAt === null) return undefined;
  return {
    id: row.id,
    country: typeof row.country === "string" ? row.country : null,
    uid: row.uid,
    email: typeof row.email === "string" ? row.email : null,
    plan,
    days: PAYMENT_PLAN_DAYS[plan],
    amountMinor,
    currency: row.currency,
    limits: { maxRequests, maxChars },
    status,
    createdAt,
    decidedAt: int(row.decided_at),
    receiptKey: typeof row.proof_key === "string" ? row.proof_key : null,
    receiptType: RECEIPT_TYPES.find((candidate) => candidate === row.proof_mime) ?? null,
    receiptBytes: int(row.proof_bytes),
    receiptUploadedAt: int(row.proof_uploaded_at),
    receiptExpiresAt: int(row.receipt_expires_at),
  };
}

/**
 * ¿Se puede descargar el comprobante ahora? Pendiente: sí mientras tenga referencia (se conserva durante la revisión,
 * pasen los días que pasen). Aprobada o rechazada: solo hasta subida + 90 días.
 */
export function receiptAvailable(request: StoredPaymentRequest, now: number): boolean {
  if (request.receiptKey === null || request.receiptExpiresAt === null) return false;
  return request.status === "pending" || request.receiptExpiresAt > now;
}

/** Vista pública: sin la clave del objeto, con la disponibilidad calculada en el momento. */
export function paymentRequestView(request: StoredPaymentRequest, now: number): PaymentRequestView {
  const { receiptType, receiptBytes, receiptUploadedAt, receiptExpiresAt } = request;
  const receipt =
    receiptType !== null && receiptBytes !== null && receiptUploadedAt !== null && receiptExpiresAt !== null
      ? {
          type: receiptType,
          bytes: receiptBytes,
          uploadedAt: receiptUploadedAt,
          expiresAt: receiptExpiresAt,
          available: receiptAvailable(request, now),
        }
      : null;
  return {
    id: request.id,
    country: request.country,
    plan: request.plan,
    days: request.days,
    amountMinor: request.amountMinor,
    currency: request.currency,
    limits: request.limits,
    status: request.status,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
    receipt,
  };
}

export function adminPaymentRequestView(request: StoredPaymentRequest, now: number): AdminPaymentRequestView {
  return { ...paymentRequestView(request, now), uid: request.uid, email: request.email };
}

const COLUMNS = `p.id AS id, p.country AS country, p.uid AS uid, u.email AS email, p.plan AS plan, p.amount_minor AS amount_minor,
  p.currency AS currency, p.max_requests AS max_requests, p.max_chars AS max_chars, p.status AS status,
  p.created_at AS created_at, p.decided_at AS decided_at, p.proof_key AS proof_key, p.proof_mime AS proof_mime,
  p.proof_bytes AS proof_bytes, p.proof_uploaded_at AS proof_uploaded_at, p.receipt_expires_at AS receipt_expires_at`;

/** Cursor de paginación «created_at.id» (orden descendente estable). */
function cursorOf(request: StoredPaymentRequest): string {
  return `${String(request.createdAt)}.${request.id}`;
}

function parseCursor(cursor: string | null): { at: number | null; id: string | null } {
  if (cursor === null) return { at: null, id: null };
  const dot = cursor.indexOf(".");
  const at = Number(cursor.slice(0, dot));
  return dot > 0 && Number.isSafeInteger(at) ? { at, id: cursor.slice(dot + 1) } : { at: null, id: null };
}

export function createD1PaymentStore(db: D1Database): PaymentStore {
  async function get(id: string): Promise<StoredPaymentRequest | null> {
    const row = await db
      .prepare(`SELECT ${COLUMNS} FROM payment_requests p LEFT JOIN users u ON u.uid = p.uid WHERE p.id = ?1`)
      .bind(id)
      .first<Row>();
    return row ? (requestFrom(row) ?? null) : null;
  }

  async function findByKey(uid: string, idempotencyKey: string): Promise<StoredPaymentRequest | null> {
    const row = await db
      .prepare(`SELECT ${COLUMNS} FROM payment_requests p LEFT JOIN users u ON u.uid = p.uid WHERE p.uid = ?1 AND p.idempotency_key = ?2`)
      .bind(uid, idempotencyKey)
      .first<Row>();
    return row ? (requestFrom(row) ?? null) : null;
  }

  async function page(where: string, binds: unknown[], cursor: string | null, limit: number): Promise<Page<StoredPaymentRequest>> {
    const { at, id } = parseCursor(cursor);
    const n = binds.length;
    const { results } = await db
      .prepare(
        `SELECT ${COLUMNS} FROM payment_requests p LEFT JOIN users u ON u.uid = p.uid
         WHERE ${where} AND (?${String(n + 1)} IS NULL OR p.created_at < ?${String(n + 1)}
           OR (p.created_at = ?${String(n + 1)} AND p.id < ?${String(n + 2)}))
         ORDER BY p.created_at DESC, p.id DESC LIMIT ?${String(n + 3)}`,
      )
      .bind(...binds, at, id, limit + 1)
      .all<Row>();
    const items: StoredPaymentRequest[] = [];
    for (const row of results.slice(0, limit)) {
      const request = requestFrom(row);
      if (request) items.push(request);
    }
    const last = items.at(-1);
    return { items, nextCursor: results.length > limit && last ? cursorOf(last) : null };
  }

  return {
    async create(uid, request, now) {
      // INSERT OR IGNORE: si choca con la misma clave de idempotencia o con otra pendiente del usuario, no inserta;
      // luego se decide leyendo por la clave (sin carreras: los índices únicos garantizan el resultado).
      await db
        .prepare(
          `INSERT OR IGNORE INTO payment_requests
             (id, uid, plan, amount_minor, currency, status, idempotency_key, created_at, days, max_requests, max_chars, country)
           VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          request.id,
          uid,
          request.plan,
          request.amountMinor,
          request.currency,
          request.idempotencyKey,
          now,
          PAYMENT_PLAN_DAYS[request.plan],
          request.limits.maxRequests,
          request.limits.maxChars,
          request.country,
        )
        .run();
      const existing = await findByKey(uid, request.idempotencyKey);
      if (!existing) return { outcome: "pending_exists" };
      if (existing.id === request.id) return { outcome: "created", request: existing };
      // La misma clave solo vale para el mismo país y plan: si no, conflicto (nunca otra solicitud).
      return existing.plan === request.plan && existing.country === request.country ? { outcome: "existing", request: existing } : { outcome: "mismatch" };
    },

    get,

    findByKey,

    listMine: (uid, cursor, limit) => page("p.uid = ?1", [uid], cursor, limit),

    listAll: (status, cursor, limit) => page("(?1 IS NULL OR p.status = ?1)", [status], cursor, limit),

    async attachReceipt(id, uid, receipt) {
      const result = await db
        .prepare(
          `UPDATE payment_requests SET proof_key = ?3, proof_mime = ?4, proof_bytes = ?5, proof_uploaded_at = ?6,
             receipt_expires_at = ?7
           WHERE id = ?1 AND uid = ?2 AND status = 'pending' AND proof_key IS NULL AND receipt_purged_at IS NULL
             AND proof_uploaded_at IS NULL`,
        )
        .bind(id, uid, receipt.key, receipt.type, receipt.bytes, receipt.uploadedAt, receipt.expiresAt)
        .run();
      return result.meta.changes === 1;
    },

    async approve(id, nonce, now, actorUid) {
      const ours = "(SELECT %s FROM payment_requests WHERE id = ?1 AND decision_nonce = ?2)";
      const of = (column: string) => ours.replace("%s", column);
      const fresh = `${of("grant_applied_at")} IS NULL`;
      const [decided] = await db.batch([
        // 1) Gana UNA sola decisión: la que pasa la fila de pending a approved con su nonce. Exige comprobante, pero no
        //    que esté dentro de los 90 días: una pendiente lo conserva durante la revisión. El tope de 400 días va en
        //    la misma condición: si el nuevo vencimiento lo superara, nada cambia (ni estado, ni renovación, ni audit).
        db
          .prepare(
            `UPDATE payment_requests SET status = 'approved', decided_at = ?3, decision_nonce = ?2
             WHERE id = ?1 AND status = 'pending' AND proof_key IS NOT NULL
               AND MAX(?3, COALESCE((SELECT s.expires_at FROM subscriptions s WHERE s.uid = payment_requests.uid), ?3))
                 + days * ${String(DAY_MS)} <= ?3 + ?4`,
          )
          .bind(id, nonce, now, ADMIN_CAPS.maxDays * DAY_MS),
        // 2) La renovación solo se aplica si la fila lleva NUESTRO nonce y aún no se aplicó: una segunda aprobación (o
        //    un reintento, incluso con el mismo nonce) no puede ampliar otra vez. Desde max(ahora, vencimiento actual)
        //    + 7/14/30 días, con la cuota copiada y el uso del periodo a cero.
        db
          .prepare(
            `UPDATE subscriptions SET
               status = 'active',
               plan = ${of("plan")},
               expires_at = MAX(?3, COALESCE(expires_at, ?3)) + ${of("days")} * ${String(DAY_MS)},
               period_start = ?3, used_requests = 0, used_chars = 0,
               max_requests = ${of("max_requests")}, max_chars = ${of("max_chars")}, updated_at = ?3
             WHERE uid = ${of("uid")} AND ${fresh}`,
          )
          .bind(id, nonce, now),
        db
          .prepare(
            `INSERT INTO audit (at, actor_uid, action, target_uid)
             SELECT ?3, ?4, 'payment:approve', uid FROM payment_requests
             WHERE id = ?1 AND decision_nonce = ?2 AND grant_applied_at IS NULL`,
          )
          .bind(id, nonce, now, actorUid),
        // 3) Marca la renovación como aplicada: los pasos 2 y la auditoría no vuelven a aplicar nunca.
        db
          .prepare("UPDATE payment_requests SET grant_applied_at = ?3 WHERE id = ?1 AND decision_nonce = ?2 AND grant_applied_at IS NULL")
          .bind(id, nonce, now),
      ]);
      if (decided && decided.meta.changes === 1) return "approved";
      const current = await get(id);
      if (!current) return "missing";
      if (current.status === "approved") return "already_approved";
      if (current.status === "rejected") return "rejected";
      return "not_ready";
    },

    async reject(id, now, actorUid) {
      const [decided] = await db.batch([
        db.prepare("UPDATE payment_requests SET status = 'rejected', decided_at = ?2 WHERE id = ?1 AND status = 'pending'").bind(id, now),
        db
          .prepare(
            `INSERT INTO audit (at, actor_uid, action, target_uid)
             SELECT ?2, ?3, 'payment:reject', uid FROM payment_requests WHERE id = ?1 AND status = 'rejected' AND decided_at = ?2`,
          )
          .bind(id, now, actorUid),
      ]);
      if (decided && decided.meta.changes === 1) return "rejected";
      const current = await get(id);
      if (!current) return "missing";
      return current.status === "approved" ? "approved" : "already_rejected";
    },

    async expiredReceipts(now, limit) {
      const { results } = await db
        .prepare(
          `SELECT id, proof_key FROM payment_requests
           WHERE proof_key IS NOT NULL AND status IN ('approved', 'rejected') AND receipt_expires_at <= ?1
           ORDER BY receipt_expires_at LIMIT ?2`,
        )
        .bind(now, limit)
        .all<Row>();
      const expired: { id: string; key: string }[] = [];
      for (const row of results) {
        if (typeof row.id === "string" && typeof row.proof_key === "string") expired.push({ id: row.id, key: row.proof_key });
      }
      return expired;
    },

    async forgetReceipt(id, key, now) {
      await db
        .prepare("UPDATE payment_requests SET proof_key = NULL, receipt_purged_at = ?3 WHERE id = ?1 AND proof_key = ?2")
        .bind(id, key, now)
        .run();
    },

    async isReferenced(key) {
      return (await db.prepare("SELECT 1 AS found FROM payment_requests WHERE proof_key = ?1 LIMIT 1").bind(key).first()) !== null;
    },
  };
}

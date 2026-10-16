import {
  ADMIN_CAPS,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_TRANSLATION_SETTINGS,
  parsePaymentSettings,
  parseTranslationSettings,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
  type AdminSettings,
  type SettingsUpdate,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type SubscriptionUpdate,
  type SubscriptionView,
  type TranslationProvider,
} from "@dialon/contracts";

// Persistencia en D1 (binding `DB`, solo local por ahora). Usuarios propios de la app, suscripción manual, ajustes del
// propietario, estado de proveedores y auditoría. NUNCA guarda texto, traducciones, audio ni tokens. El uid y el
// email del propietario solo aparecen en `audit` (D1), nunca en logs.

export interface StoredSubscription {
  readonly status: SubscriptionStatus;
  readonly plan: SubscriptionPlan | null;
  readonly periodStart: number | null;
  readonly expiresAt: number | null;
  readonly maxRequests: number;
  readonly maxChars: number;
  readonly usedRequests: number;
  readonly usedChars: number;
}

export interface StoredUser {
  readonly uid: string;
  readonly email: string | null;
  readonly createdAt: number;
  readonly subscription: StoredSubscription;
}

export type Reservation = "ok" | "subscription" | "quota";

export interface ProviderRecord {
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
}

export interface Store {
  /** Registra o actualiza el usuario (tras un JWT válido) y crea su suscripción `inactive` si no existe. */
  readonly touchUser: (uid: string, email: string | null, now: number) => Promise<void>;
  readonly getSubscription: (uid: string) => Promise<StoredSubscription | null>;
  readonly listUsers: (cursor: string | null, limit: number) => Promise<{ users: StoredUser[]; nextCursor: string | null }>;
  /** `null` si el usuario no está registrado. */
  readonly setSubscription: (
    uid: string,
    update: SubscriptionUpdate,
    now: number,
    actorUid: string,
  ) => Promise<StoredSubscription | null>;
  readonly getSettings: () => Promise<AdminSettings>;
  readonly updateSettings: (update: SettingsUpdate, now: number, actorUid: string) => Promise<AdminSettings>;
  /** Reserva atómica de una petición y `chars` caracteres del periodo, antes de llamar al proveedor. */
  readonly reserveQuota: (uid: string, chars: number, now: number) => Promise<Reservation>;
  readonly recordProvider: (provider: TranslationProvider, ok: boolean, now: number) => Promise<void>;
  readonly providerRecords: () => Promise<Readonly<Record<TranslationProvider, ProviderRecord>>>;
}

/** Usable para traducir: activa y con vencimiento futuro. */
export function subscriptionUsable(subscription: StoredSubscription | null, now: number): boolean {
  return subscription !== null && subscription.status === "active" && subscription.expiresAt !== null && subscription.expiresAt > now;
}

export function subscriptionView(subscription: StoredSubscription | null, now: number): SubscriptionView {
  if (subscription === null) {
    return { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } };
  }
  const expired = subscription.status === "active" && (subscription.expiresAt === null || subscription.expiresAt <= now);
  return {
    status: expired ? "expired" : subscription.status,
    plan: subscription.plan,
    expiresAt: subscription.expiresAt,
    limits: subscription.plan === null ? null : { maxRequests: subscription.maxRequests, maxChars: subscription.maxChars },
    usage: { requests: subscription.usedRequests, chars: subscription.usedChars },
  };
}

type Row = Record<string, unknown>;

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function subscriptionFrom(row: Row): StoredSubscription {
  const status = SUBSCRIPTION_STATUSES.find((candidate) => candidate === row.status) ?? "inactive";
  const plan = SUBSCRIPTION_PLANS.find((candidate) => candidate === row.plan) ?? null;
  return {
    status,
    plan,
    periodStart: int(row.period_start),
    expiresAt: int(row.expires_at),
    maxRequests: Math.min(int(row.max_requests) ?? 0, ADMIN_CAPS.maxRequests),
    maxChars: Math.min(int(row.max_chars) ?? 0, ADMIN_CAPS.maxChars),
    usedRequests: int(row.used_requests) ?? 0,
    usedChars: int(row.used_chars) ?? 0,
  };
}

const SUBSCRIPTION_COLUMNS = "status, plan, period_start, expires_at, max_requests, max_chars, used_requests, used_chars";

// Empieza un periodo nuevo (uso a cero) si se activa algo que no estaba activo y vigente, o si se amplía el vencimiento.
// Se evalúa con los valores ANTERIORES de la fila en la misma sentencia: sin carreras entre lectura y escritura.
const NEW_PERIOD = "(?2 = 'active' AND (status <> 'active' OR expires_at IS NULL OR expires_at <= ?7 OR ?4 > expires_at))";

const SET_SUBSCRIPTION = `UPDATE subscriptions SET
  period_start = CASE WHEN ${NEW_PERIOD} THEN ?7 ELSE period_start END,
  used_requests = CASE WHEN ${NEW_PERIOD} THEN 0 ELSE used_requests END,
  used_chars = CASE WHEN ${NEW_PERIOD} THEN 0 ELSE used_chars END,
  status = ?2, plan = ?3, expires_at = ?4, max_requests = ?5, max_chars = ?6, updated_at = ?7
  WHERE uid = ?1`;

// Una sola sentencia: comprueba estado, vencimiento y cuota y suma el uso a la vez. Dos peticiones simultáneas nunca
// pueden pasar ambas del límite.
const RESERVE = `UPDATE subscriptions SET used_requests = used_requests + 1, used_chars = used_chars + ?2, updated_at = ?3
  WHERE uid = ?1 AND status = 'active' AND expires_at > ?3
    AND used_requests + 1 <= max_requests AND used_chars + ?2 <= max_chars`;

function parseStored<T>(raw: unknown, parse: (value: unknown) => { ok: true; value: T } | { ok: false }, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  const parsed = parse(value);
  // Un valor guardado inválido cae en el valor por defecto, que es el más restrictivo.
  return parsed.ok ? parsed.value : fallback;
}

export function createD1Store(db: D1Database): Store {
  async function getSubscription(uid: string): Promise<StoredSubscription | null> {
    const row = await db.prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE uid = ?1`).bind(uid).first<Row>();
    return row ? subscriptionFrom(row) : null;
  }

  async function getSettings(): Promise<AdminSettings> {
    const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN ('translation', 'payments')").all<Row>();
    const byKey = new Map(results.map((row) => [row.key, row.value]));
    return {
      translation: parseStored(byKey.get("translation"), parseTranslationSettings, DEFAULT_TRANSLATION_SETTINGS),
      payments: parseStored(byKey.get("payments"), parsePaymentSettings, DEFAULT_PAYMENT_SETTINGS),
    };
  }

  return {
    async touchUser(uid, email, now) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users (uid, email, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT (uid) DO UPDATE SET email = excluded.email, last_seen_at = excluded.last_seen_at`,
          )
          .bind(uid, email, now),
        db.prepare("INSERT OR IGNORE INTO subscriptions (uid, status, updated_at) VALUES (?1, 'inactive', ?2)").bind(uid, now),
      ]);
    },

    getSubscription,

    async listUsers(cursor, limit) {
      const size = Math.min(Math.max(1, Math.trunc(limit)), ADMIN_CAPS.maxUsersPage);
      const { results } = await db
        .prepare(
          `SELECT u.uid AS uid, u.email AS email, u.created_at AS created_at,
             s.status AS status, s.plan AS plan, s.period_start AS period_start, s.expires_at AS expires_at,
             s.max_requests AS max_requests, s.max_chars AS max_chars, s.used_requests AS used_requests, s.used_chars AS used_chars
           FROM users u LEFT JOIN subscriptions s ON s.uid = u.uid
           WHERE ?1 IS NULL OR u.uid > ?1
           ORDER BY u.uid LIMIT ?2`,
        )
        .bind(cursor, size + 1)
        .all<Row>();
      const users: StoredUser[] = [];
      for (const row of results.slice(0, size)) {
        if (typeof row.uid !== "string") continue;
        users.push({
          uid: row.uid,
          email: typeof row.email === "string" ? row.email : null,
          createdAt: int(row.created_at) ?? 0,
          subscription: subscriptionFrom(row),
        });
      }
      const last = users.at(-1);
      return { users, nextCursor: results.length > size && last ? last.uid : null };
    },

    async setSubscription(uid, update, now, actorUid) {
      const [result] = await db.batch([
        db
          .prepare(SET_SUBSCRIPTION)
          .bind(uid, update.status, update.plan, update.expiresAt, update.limits.maxRequests, update.limits.maxChars, now),
        db
          .prepare(
            `INSERT INTO audit (at, actor_uid, action, target_uid)
             SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM subscriptions WHERE uid = ?4)`,
          )
          .bind(now, actorUid, `subscription:${update.status}`, uid),
      ]);
      if (!result || result.meta.changes !== 1) return null;
      return getSubscription(uid);
    },

    getSettings,

    async updateSettings(update, now, actorUid) {
      const statements: D1PreparedStatement[] = [];
      const upsert = `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
      if (update.translation) statements.push(db.prepare(upsert).bind("translation", JSON.stringify(update.translation), now));
      if (update.payments) statements.push(db.prepare(upsert).bind("payments", JSON.stringify(update.payments), now));
      const sections = [update.translation ? "translation" : "", update.payments ? "payments" : ""].filter(Boolean).join(",");
      statements.push(
        db.prepare("INSERT INTO audit (at, actor_uid, action, target_uid) VALUES (?1, ?2, ?3, NULL)").bind(now, actorUid, `settings:${sections}`),
      );
      await db.batch(statements);
      return getSettings();
    },

    async reserveQuota(uid, chars, now) {
      const result = await db.prepare(RESERVE).bind(uid, chars, now).run();
      if (result.meta.changes === 1) return "ok";
      // Sin cambios: o ya no es usable (suspendida, vencida, inactiva) o no queda cuota del periodo.
      return subscriptionUsable(await getSubscription(uid), now) ? "quota" : "subscription";
    },

    async recordProvider(provider, ok, now) {
      const column = ok ? "last_success_at" : "last_failure_at";
      await db
        .prepare(
          `INSERT INTO provider_status (provider, ${column}) VALUES (?1, ?2)
           ON CONFLICT (provider) DO UPDATE SET ${column} = excluded.${column}`,
        )
        .bind(provider, now)
        .run();
    },

    async providerRecords() {
      const { results } = await db.prepare("SELECT provider, last_success_at, last_failure_at FROM provider_status").all<Row>();
      const records: Record<TranslationProvider, ProviderRecord> = {
        sarin: { lastSuccessAt: null, lastFailureAt: null },
        deepseek: { lastSuccessAt: null, lastFailureAt: null },
      };
      for (const row of results) {
        if (row.provider === "sarin" || row.provider === "deepseek") {
          records[row.provider] = { lastSuccessAt: int(row.last_success_at), lastFailureAt: int(row.last_failure_at) };
        }
      }
      return records;
    },
  };
}

/** Binding D1 `DB` si existe; sin él, las rutas que lo necesitan responden 503 (falla cerrado). */
export function d1From(env: object): D1Database | undefined {
  if (!("DB" in env)) return undefined;
  const db: unknown = (env as Record<string, unknown>).DB;
  return typeof db === "object" && db !== null && typeof (db as { prepare?: unknown }).prepare === "function"
    ? (db as D1Database)
    : undefined;
}

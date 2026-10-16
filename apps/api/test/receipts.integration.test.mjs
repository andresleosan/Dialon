// Integración en workerd REAL (Miniflare) con D1 y R2 LOCALES en memoria: solicitudes por transferencia, comprobantes
// privados y limpieza de retención (handler `scheduled` invocado a mano; no hay cron). Documentos SINTÉTICOS mínimos,
// tokens sintéticos, uid de propietario ficticio. Ninguna salida a red salvo el JWKS de prueba; ningún coste.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./support/local-d1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "..", "..", ".tools", "api", "bundle", "index.js");
const migrations = join(here, "..", "migrations");
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const OWNER_EMAIL = "andres.san1404@gmail.com";
const OWNER_UID = "uid-propietario-ficticio";
const DAY = 86_400_000;
const PDF = new globalThis.TextEncoder().encode("%PDF-1.4\n% SINTETICO DE PRUEBA, NO ES UN PAGO\n%%EOF\n");
// Catálogo por país con UN mercado FICTICIO (Colombia, COP); importes en unidad menor.
const COUNTRY = "CO";
const PAYMENTS = {
  enabled: true,
  markets: [
    {
      country: COUNTRY,
      currency: "COP",
      instructions: "DATOS FICTICIOS DE PRUEBA",
      prices: { weekly: 100, biweekly: 180, monthly: 300 },
      planLimits: {
        weekly: { maxRequests: 5, maxChars: 1000 },
        biweekly: { maxRequests: 9, maxChars: 1800 },
        monthly: { maxRequests: 15, maxChars: 3000 },
      },
    },
  ],
};
const KEY_FORMAT = /^receipts\/\d{13}-[0-9a-f-]{36}$/;

const key = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(key.publicKey)), kid: "kid-recibos", alg: "RS256", use: "sig" }] };
const unexpected = [];

async function token(sub, email = `${sub}@example.com`) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: now - 60, email, email_verified: true })
    .setProtectedHeader({ alg: "RS256", kid: "kid-recibos" })
    .setIssuer("https://securetoken.google.com/dialonapp")
    .setAudience("dialonapp")
    .setSubject(sub)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 3000)
    .sign(key.privateKey);
}

describe("Comprobantes en workerd con D1/R2 locales", () => {
  let mf;
  let db;
  let bucket;
  let owner;
  let settingsStatus;

  async function call(method, path, authorization, body, contentType = "application/json") {
    const response = await mf.dispatchFetch(`https://api.example${path}`, {
      method,
      headers: {
        Origin: "https://dialon.pages.dev",
        Authorization: `Bearer ${authorization}`,
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let json;
    try {
      json = JSON.parse(new globalThis.TextDecoder().decode(bytes));
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  }

  /** Usuario registrado con una solicitud pendiente y su comprobante subido. */
  async function pendingWithReceipt(uid, plan = "weekly") {
    const authorization = await token(uid);
    expect((await call("GET", "/v1/me", authorization)).status).toBe(200);
    const created = await call("POST", "/v1/me/payment-requests", authorization, { country: COUNTRY, plan, idempotencyKey: globalThis.crypto.randomUUID() });
    expect(created.status).toBe(201);
    const uploaded = await call("PUT", `/v1/me/payment-requests/${created.json.id}/receipt`, authorization, PDF, "application/pdf");
    expect(uploaded.status).toBe(201);
    return { authorization, id: created.json.id };
  }

  async function storedKey(id) {
    return (await db.prepare("SELECT proof_key FROM payment_requests WHERE id = ?1").bind(id).first())?.proof_key ?? null;
  }

  beforeAll(async () => {
    expect(existsSync(bundle)).toBe(true);
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        scriptPath: bundle,
        compatibilityDate: "2026-10-06",
        compatibilityFlags: ["nodejs_compat"],
        // Purga activada SOLO en este fixture, de forma explícita, para probar el borrado con `scheduled`.
        bindings: {
          ALLOWED_ORIGINS: "https://dialon.pages.dev",
          OWNER_EMAIL,
          OWNER_FIREBASE_UID: OWNER_UID,
          SARIN_AUTH_MODE: "none",
          RECEIPT_PURGE_ENABLED: "true",
        },
        d1Databases: ["DB"],
        r2Buckets: ["PROOFS"],
        ratelimits: { TRANSLATE_LIMITER: { namespace_id: "4101", simple: { limit: 100, period: 60 } } },
        outboundService: (request) => {
          if (request.url === JWKS_URL) return new globalThis.Response(JSON.stringify(jwks), { headers: { "Content-Type": "application/json" } });
          unexpected.push(request.url);
          return new globalThis.Response("host inesperado", { status: 599 });
        },
      }),
    );
    await mf.ready;
    await applyMigrations(mf, migrations);
    db = await mf.getD1Database("DB");
    bucket = await mf.getR2Bucket("PROOFS");
    owner = await token(OWNER_UID, OWNER_EMAIL);
    // Sin aserción aquí: si el catálogo no se acepta, lo dice la primera prueba y no se bloquea la preparación.
    settingsStatus = (await call("PUT", "/v1/admin/settings", owner, { payments: PAYMENTS })).status;
  });

  it("el propietario guarda el catálogo por país", () => {
    expect(settingsStatus).toBe(200);
  });

  afterAll(async () => {
    await mf?.dispose();
  });

  afterEach(() => {
    expect(unexpected).toEqual([]);
  });

  it("el comprobante se guarda con clave del servidor `receipts/<fecha>-<uuid>` y el reintento de subida es 409 sin tocar el objeto", async () => {
    const { authorization, id } = await pendingWithReceipt("uid-clave");
    const stored = await storedKey(id);
    expect(stored).toMatch(KEY_FORMAT);
    expect(await bucket.head(stored)).not.toBeNull();
    const again = await call("PUT", `/v1/me/payment-requests/${id}/receipt`, authorization, PDF, "application/pdf");
    expect(again.status).toBe(409);
    expect(await storedKey(id)).toBe(stored);
    expect((await bucket.list({ prefix: "receipts/" })).objects.filter((object) => object.key === stored)).toHaveLength(1);
  });

  it("el reintento con la misma clave devuelve la solicitud aunque el propietario desactive los pagos; otro plan con esa clave es 409", async () => {
    const authorization = await token("uid-reintento");
    const idempotencyKey = globalThis.crypto.randomUUID();
    const first = await call("POST", "/v1/me/payment-requests", authorization, { country: COUNTRY, plan: "weekly", idempotencyKey });
    expect(first.status).toBe(201);
    try {
      expect((await call("PUT", "/v1/admin/settings", owner, { payments: { ...PAYMENTS, enabled: false } })).status).toBe(200);
      const retry = await call("POST", "/v1/me/payment-requests", authorization, { country: COUNTRY, plan: "weekly", idempotencyKey });
      expect(retry.status).toBe(200);
      expect(retry.json.id).toBe(first.json.id);
      expect(retry.json.amountMinor).toBe(100);
      expect((await call("POST", "/v1/me/payment-requests", authorization, { country: COUNTRY, plan: "monthly", idempotencyKey })).status).toBe(409);
      // Una solicitud NUEVA sí depende de la configuración actual.
      const fresh = await call("POST", "/v1/me/payment-requests", await token("uid-reintento-2"), { country: COUNTRY, plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() });
      expect(fresh.status).toBe(409);
      expect(fresh.json).toMatchObject({ error: { code: "PAYMENTS_DISABLED" } });
    } finally {
      await call("PUT", "/v1/admin/settings", owner, { payments: PAYMENTS });
    }
  });

  it("aprobar no supera 400 días: 409 sin cambiar la solicitud, la suscripción ni la auditoría", async () => {
    const uid = "uid-tope";
    const authorization = await token(uid);
    expect((await call("GET", "/v1/me", authorization)).status).toBe(200);
    const expiresAt = Date.now() + 399 * DAY;
    const limits = { maxRequests: 5, maxChars: 1000 };
    expect((await call("PUT", `/v1/admin/users/${uid}/subscription`, owner, { status: "active", plan: "custom", expiresAt, limits })).status).toBe(200);
    const created = await call("POST", "/v1/me/payment-requests", authorization, { country: COUNTRY, plan: "monthly", idempotencyKey: globalThis.crypto.randomUUID() });
    expect((await call("PUT", `/v1/me/payment-requests/${created.json.id}/receipt`, authorization, PDF, "application/pdf")).status).toBe(201);
    const audits = async () => (await db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'payment:approve' AND target_uid = ?1").bind(uid).first()).n;

    expect((await call("POST", `/v1/admin/payment-requests/${created.json.id}/approve`, owner)).status).toBe(409);
    expect((await call("GET", "/v1/me", authorization)).json.subscription.expiresAt).toBe(expiresAt);
    expect((await call("GET", "/v1/me/payment-requests", authorization)).json.requests[0]).toMatchObject({ status: "pending", decidedAt: null });
    expect(await audits()).toBe(0);
  });

  it("aprobar dos veces (en paralelo y repetido) amplía una sola vez y audita una sola vez", async () => {
    const { authorization, id } = await pendingWithReceipt("uid-doble", "biweekly");
    const before = Date.now();
    const statuses = (await Promise.all([1, 2].map(() => call("POST", `/v1/admin/payment-requests/${id}/approve`, owner)))).map((r) => r.status);
    expect(statuses).toEqual([200, 200]);
    expect((await call("POST", `/v1/admin/payment-requests/${id}/approve`, owner)).status).toBe(200);
    const { subscription } = (await call("GET", "/v1/me", authorization)).json;
    expect(subscription).toMatchObject({ status: "active", plan: "biweekly", limits: { maxRequests: 9, maxChars: 1800 } });
    expect(subscription.expiresAt).toBeGreaterThanOrEqual(before + 14 * DAY);
    expect(subscription.expiresAt).toBeLessThan(before + 15 * DAY);
    const audits = await db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'payment:approve' AND target_uid = 'uid-doble'").first();
    expect(audits.n).toBe(1);
  });

  /** Simula que pasaron más de 90 días desde la subida (solo la fecha en D1; el objeto en R2 no cambia). */
  async function age(id) {
    await db.prepare("UPDATE payment_requests SET receipt_expires_at = ?2 WHERE id = ?1").bind(id, Date.now() - 1).run();
  }

  it("pendiente con más de 90 días: autor y propietario descargan, los listados lo dan disponible y se puede aprobar a mano", async () => {
    const uid = "uid-pendiente-antiguo";
    const { authorization, id } = await pendingWithReceipt(uid, "weekly");
    await age(id);

    const mine = await call("GET", `/v1/me/payment-requests/${id}/receipt`, authorization);
    expect(mine.status).toBe(200);
    expect((await call("GET", `/v1/admin/payment-requests/${id}/receipt`, owner)).status).toBe(200);
    // Autorización estricta: otra cuenta sigue sin verlo.
    expect((await call("GET", `/v1/me/payment-requests/${id}/receipt`, await token("uid-ajeno"))).status).toBe(404);

    const listed = (await call("GET", "/v1/me/payment-requests", authorization)).json.requests.find((item) => item.id === id);
    expect(listed).toMatchObject({ status: "pending", receipt: { available: true } });
    const adminListed = (await call("GET", "/v1/admin/payment-requests?status=pending&limit=50", owner)).json.requests.find((item) => item.id === id);
    expect(adminListed).toMatchObject({ receipt: { available: true } });

    const approved = await call("POST", `/v1/admin/payment-requests/${id}/approve`, owner);
    expect(approved.status).toBe(200);
    expect(approved.json.request).toMatchObject({ status: "approved" });
    expect((await call("GET", "/v1/me", authorization)).json.subscription).toMatchObject({ status: "active", plan: "weekly" });
    // Ya aprobada, vuelve la regla de subida + 90 días.
    expect((await call("GET", `/v1/me/payment-requests/${id}/receipt`, authorization)).status).toBe(410);
  });

  it("aprobadas y rechazadas: acceso hasta subida + 90 días; después 410 para autor y propietario", async () => {
    const recentApproved = await pendingWithReceipt("uid-aprobada-reciente");
    expect((await call("POST", `/v1/admin/payment-requests/${recentApproved.id}/approve`, owner)).status).toBe(200);
    const recentRejected = await pendingWithReceipt("uid-rechazada-reciente");
    expect((await call("POST", `/v1/admin/payment-requests/${recentRejected.id}/reject`, owner)).status).toBe(200);
    for (const { authorization, id } of [recentApproved, recentRejected]) {
      expect((await call("GET", `/v1/me/payment-requests/${id}/receipt`, authorization)).status).toBe(200);
      expect((await call("GET", `/v1/admin/payment-requests/${id}/receipt`, owner)).status).toBe(200);
    }

    const oldApproved = await pendingWithReceipt("uid-aprobada-vencida");
    expect((await call("POST", `/v1/admin/payment-requests/${oldApproved.id}/approve`, owner)).status).toBe(200);
    const oldRejected = await pendingWithReceipt("uid-rechazada-vencida");
    expect((await call("POST", `/v1/admin/payment-requests/${oldRejected.id}/reject`, owner)).status).toBe(200);
    for (const { authorization, id } of [oldApproved, oldRejected]) {
      await age(id);
      expect((await call("GET", `/v1/me/payment-requests/${id}/receipt`, authorization)).status).toBe(410);
      expect((await call("GET", `/v1/admin/payment-requests/${id}/receipt`, owner)).status).toBe(410);
      const listed = (await call("GET", "/v1/me/payment-requests", authorization)).json.requests.find((item) => item.id === id);
      expect(listed.receipt).toMatchObject({ available: false });
      // Sin purga todavía: el objeto sigue en R2 hasta que se ejecute la limpieza autorizada.
      expect(await bucket.head(await storedKey(id))).not.toBeNull();
    }
  });

  it("scheduled: borra comprobantes vencidos y huérfanos de más de 90 días; conserva los recientes y las claves ajenas", async () => {
    const { authorization, id } = await pendingWithReceipt("uid-retencion");
    // Resuelta (rechazada): una pendiente nunca se purga.
    expect((await call("POST", `/v1/admin/payment-requests/${id}/reject`, owner)).status).toBe(200);
    const referenced = await storedKey(id);
    const pendingOld = await pendingWithReceipt("uid-pendiente-protegida");
    const pendingKey = await storedKey(pendingOld.id);
    await age(pendingOld.id);
    const recent = await pendingWithReceipt("uid-reciente");
    const recentKey = await storedKey(recent.id);
    // Huérfano con el formato de la app (subida interrumpida) y una clave con otro formato que no es de la app.
    const orphan = `receipts/${String(Date.now()).padStart(13, "0")}-${globalThis.crypto.randomUUID()}`;
    await bucket.put(orphan, PDF);
    await bucket.put("receipts/ajeno.pdf", PDF);
    // Solo la solicitud de «uid-retencion» y el huérfano pasan a tener más de 90 días: se adelanta su fecha en D1 y se
    // ejecuta la limpieza en un instante futuro en el que lo «reciente» sigue dentro de la retención.
    const future = Date.now() + 91 * DAY;
    await db.prepare("UPDATE payment_requests SET receipt_expires_at = ?2 WHERE id = ?1").bind(id, Date.now() - 1).run();
    await db.prepare("UPDATE payment_requests SET receipt_expires_at = ?2 WHERE id = ?1").bind(recent.id, future + DAY).run();

    expect((await call("GET", `/v1/me/payment-requests/${id}/receipt`, authorization)).status).toBe(410);
    const worker = await mf.getWorker();
    await worker.scheduled({ scheduledTime: new Date(future) });

    expect(await bucket.head(referenced)).toBeNull();
    expect(await storedKey(id)).toBeNull();
    expect(await bucket.head(orphan)).toBeNull();
    expect(await bucket.head("receipts/ajeno.pdf")).not.toBeNull();
    // Lo reciente: su clave es de hoy, pero sigue referenciado y dentro de su retención en D1.
    expect(await bucket.head(recentKey)).not.toBeNull();
    expect(await storedKey(recent.id)).toBe(recentKey);
    // Pendiente antigua: ni el objeto ni la referencia se tocan, y el autor la sigue descargando.
    expect(await bucket.head(pendingKey)).not.toBeNull();
    expect(await storedKey(pendingOld.id)).toBe(pendingKey);
    expect((await call("GET", `/v1/me/payment-requests/${pendingOld.id}/receipt`, pendingOld.authorization)).status).toBe(200);
    const listed = (await call("GET", "/v1/me/payment-requests", authorization)).json.requests[0];
    expect(listed.receipt).toMatchObject({ type: "application/pdf", available: false });
    expect((await call("GET", `/v1/admin/payment-requests/${id}/receipt`, owner)).status).toBe(410);
  });
});

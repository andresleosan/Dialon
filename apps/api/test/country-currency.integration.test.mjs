// País y moneda en workerd REAL (Miniflare) con D1/R2 LOCALES: catálogo por mercado, solicitud con país, snapshot
// congelado e idempotencia. Mercados, importes e instrucciones FICTICIOS; tokens sintéticos generados en memoria. Sin
// red salvo el JWKS de prueba, sin cron, sin recursos remotos.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./support/local-d1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "..", "..", ".tools", "api", "bundle", "index.js");
const migrations = join(here, "..", "migrations");
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const OWNER_EMAIL = "andres.san1404@gmail.com";
const OWNER_UID = "uid-propietario-ficticio";

const key = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(key.publicKey)), kid: "kid-pais", alg: "RS256", use: "sig" }] };
const unexpected = [];

const LIMITS_CO = { maxRequests: 20, maxChars: 4000 };
const LIMITS_JE = { maxRequests: 10, maxChars: 2000 };
function market(country, currency, prices, limits, instructions = `TRANSFERENCIA FICTICIA ${country}`) {
  return { country, currency, instructions, prices, planLimits: { weekly: limits, biweekly: limits, monthly: limits } };
}
const CO = market("CO", "COP", { weekly: 5_000_000, biweekly: 9_000_000, monthly: 15_000_000 }, LIMITS_CO);
const JE = market("JE", "GBP", { weekly: 500, biweekly: 900, monthly: 1500 }, LIMITS_JE);
const CATALOG = { enabled: true, markets: [CO, JE] };
const TWENTY = ["CO", "JE", "GB", "ES", "MX", "AR", "CL", "PE", "US", "CA", "FR", "DE", "IT", "PT", "BR", "EC", "UY", "PY", "BO", "VE"];

async function token(sub, email = `${sub}@example.com`) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: now - 60, email, email_verified: true })
    .setProtectedHeader({ alg: "RS256", kid: "kid-pais" })
    .setIssuer("https://securetoken.google.com/dialonapp")
    .setAudience("dialonapp")
    .setSubject(sub)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 3000)
    .sign(key.privateKey);
}

let mf;
let db;
let owner;

async function start() {
  expect(existsSync(bundle)).toBe(true);
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: bundle,
      compatibilityDate: "2026-10-06",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { ALLOWED_ORIGINS: "https://dialon.pages.dev", OWNER_EMAIL, OWNER_FIREBASE_UID: OWNER_UID, SARIN_AUTH_MODE: "none", RECEIPT_PURGE_ENABLED: "false" },
      d1Databases: ["DB"],
      r2Buckets: ["PROOFS"],
      ratelimits: { TRANSLATE_LIMITER: { namespace_id: "4103", simple: { limit: 100, period: 60 } } },
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
  owner = await token(OWNER_UID, OWNER_EMAIL);
}

afterEach(async () => {
  await mf?.dispose();
  mf = undefined;
  expect(unexpected).toEqual([]);
});

async function call(method, path, authorization, body) {
  const text = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const response = await mf.dispatchFetch(`https://api.example${path}`, {
    method,
    headers: {
      Origin: "https://dialon.pages.dev",
      Authorization: `Bearer ${authorization}`,
      ...(text === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: text,
  });
  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

const saveCatalog = (payments) => call("PUT", "/v1/admin/settings", owner, { payments });
const create = (authorization, body) => call("POST", "/v1/me/payment-requests", authorization, body);
const requestCount = async (uid) => (await db.prepare("SELECT COUNT(*) AS n FROM payment_requests WHERE uid = ?1").bind(uid).first()).n;

async function user(uid) {
  const authorization = await token(uid);
  expect((await call("GET", "/v1/me", authorization)).status).toBe(200);
  return authorization;
}

describe("catálogo por país", () => {
  it("por defecto: pagos apagados y catálogo vacío, en ajustes y en /v1/me", async () => {
    await start();
    expect((await call("GET", "/v1/admin/settings", owner)).json.payments).toEqual({ enabled: false, markets: [] });
    expect((await call("GET", "/v1/me", await token("uid-defecto"))).json.payments).toEqual({ enabled: false, markets: [] });
  });

  it("CO/COP y JE/GBP: el propietario los guarda y /v1/me los publica por país con sus planes 7/14/30", async () => {
    await start();
    const saved = await saveCatalog(CATALOG);
    expect(saved.status).toBe(200);
    expect(saved.json.payments).toEqual(CATALOG);
    const me = await call("GET", "/v1/me", await token("uid-catalogo"));
    expect(me.json.payments).toEqual({
      enabled: true,
      markets: [
        {
          country: "CO",
          currency: "COP",
          instructions: "TRANSFERENCIA FICTICIA CO",
          plans: [
            { plan: "weekly", days: 7, amountMinor: 5_000_000, limits: LIMITS_CO },
            { plan: "biweekly", days: 14, amountMinor: 9_000_000, limits: LIMITS_CO },
            { plan: "monthly", days: 30, amountMinor: 15_000_000, limits: LIMITS_CO },
          ],
        },
        {
          country: "JE",
          currency: "GBP",
          instructions: "TRANSFERENCIA FICTICIA JE",
          plans: [
            { plan: "weekly", days: 7, amountMinor: 500, limits: LIMITS_JE },
            { plan: "biweekly", days: 14, amountMinor: 900, limits: LIMITS_JE },
            { plan: "monthly", days: 30, amountMinor: 1500, limits: LIMITS_JE },
          ],
        },
      ],
    });
  });

  it("catálogos inválidos: 400 sin cambiar lo guardado", async () => {
    await start();
    expect((await saveCatalog(CATALOG)).status).toBe(200);
    const legacy = { enabled: true, currency: "EUR", instructions: "DATOS FICTICIOS", prices: CO.prices, planLimits: CO.planLimits };
    for (const payments of [
      { enabled: true, markets: [] },
      { enabled: true, markets: [CO, { ...JE, country: "CO" }] },
      { enabled: true, markets: [{ ...CO, country: "co" }] },
      { enabled: true, markets: [{ ...CO, currency: "XYZ" }] },
      { enabled: true, markets: [{ ...CO, prices: { ...CO.prices, monthly: null } }] },
      { enabled: true, markets: TWENTY.concat("CR").map((country) => ({ ...JE, country })) },
      legacy,
    ]) {
      expect((await saveCatalog(payments)).status).toBe(400);
    }
    expect((await call("GET", "/v1/admin/settings", owner)).json.payments).toEqual(CATALOG);
  });

  it("20 mercados con instrucciones largas (más de 16 KiB) caben; un cuerpo de más de 128 KiB es 413", async () => {
    await start();
    const twenty = { enabled: true, markets: TWENTY.map((country) => ({ ...JE, country, instructions: "F".repeat(1000) })) };
    expect(new globalThis.TextEncoder().encode(JSON.stringify({ payments: twenty })).length).toBeGreaterThan(16 * 1024);
    expect((await saveCatalog(twenty)).status).toBe(200);
    const me = await call("GET", "/v1/me", await token("uid-veinte"));
    expect(me.status).toBe(200);
    expect(me.json.payments.markets).toHaveLength(20);

    const huge = JSON.stringify({ payments: { enabled: false, markets: [] }, relleno: "x".repeat(129 * 1024) });
    expect((await call("PUT", "/v1/admin/settings", owner, huge)).status).toBe(413);
  });

  it("ajustes globales antiguos guardados en D1 se leen apagados y vacíos; nunca se asignan a un país", async () => {
    await start();
    const legacy = {
      enabled: true,
      currency: "EUR",
      instructions: "DATOS FICTICIOS ANTIGUOS",
      prices: { weekly: 100, biweekly: 180, monthly: 300 },
      planLimits: { weekly: LIMITS_JE, biweekly: LIMITS_JE, monthly: LIMITS_JE },
    };
    await db
      .prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('payments', ?1, ?2)")
      .bind(JSON.stringify(legacy), Date.now())
      .run();
    expect((await call("GET", "/v1/admin/settings", owner)).json.payments).toEqual({ enabled: false, markets: [] });
    const authorization = await user("uid-antiguo");
    expect((await call("GET", "/v1/me", authorization)).json.payments).toEqual({ enabled: false, markets: [] });
    for (const country of ["CO", "JE", "ES"]) {
      const created = await create(authorization, { country, plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() });
      expect(created.status).toBe(409);
      expect(created.json).toMatchObject({ error: { code: "PAYMENTS_DISABLED" } });
    }
    expect(await requestCount("uid-antiguo")).toBe(0);
  });
});

describe("solicitud con país", () => {
  it("exige país; no acepta moneda ni importe del cliente", async () => {
    await start();
    expect((await saveCatalog(CATALOG)).status).toBe(200);
    const authorization = await user("uid-sin-pais");
    for (const body of [
      { plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() },
      { country: "co", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() },
      { country: "CO", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID(), currency: "GBP" },
      { country: "CO", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID(), amountMinor: 1 },
    ]) {
      expect((await create(authorization, body)).status).toBe(400);
    }
    expect(await requestCount("uid-sin-pais")).toBe(0);
  });

  it("el servidor congela país, moneda, importe, días y cuota del mercado elegido (CO/COP y JE/GBP)", async () => {
    await start();
    expect((await saveCatalog(CATALOG)).status).toBe(200);
    const co = await create(await user("uid-co"), { country: "CO", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() });
    expect(co.status).toBe(201);
    expect(co.json).toMatchObject({ country: "CO", currency: "COP", amountMinor: 5_000_000, days: 7, limits: LIMITS_CO, status: "pending" });
    const je = await create(await user("uid-je"), { country: "JE", plan: "monthly", idempotencyKey: globalThis.crypto.randomUUID() });
    expect(je.status).toBe(201);
    expect(je.json).toMatchObject({ country: "JE", currency: "GBP", amountMinor: 1500, days: 30, limits: LIMITS_JE });
    const admin = await call("GET", "/v1/admin/payment-requests?status=pending", owner);
    expect(admin.json.requests.map((item) => [item.uid, item.country, item.currency]).sort()).toEqual([
      ["uid-co", "CO", "COP"],
      ["uid-je", "JE", "GBP"],
    ]);
  });

  it("un país sin mercado no crea nada ni usa la tarifa de otro país", async () => {
    await start();
    expect((await saveCatalog(CATALOG)).status).toBe(200);
    const authorization = await user("uid-gb");
    const created = await create(authorization, { country: "GB", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() });
    expect(created.status).toBe(409);
    expect(created.json).toMatchObject({ error: { code: "PAYMENTS_DISABLED" } });
    expect(await requestCount("uid-gb")).toBe(0);
  });

  it("snapshot inmutable: cambiar precio, moneda o apagar los pagos no altera la solicitud; el reintento la devuelve igual", async () => {
    await start();
    expect((await saveCatalog(CATALOG)).status).toBe(200);
    const authorization = await user("uid-snapshot");
    const idempotencyKey = globalThis.crypto.randomUUID();
    const first = await create(authorization, { country: "CO", plan: "weekly", idempotencyKey });
    expect(first.status).toBe(201);

    const changed = { enabled: true, markets: [{ ...CO, currency: "USD", prices: { weekly: 2000, biweekly: 3000, monthly: 4000 } }, JE] };
    expect((await saveCatalog(changed)).status).toBe(200);
    const snapshot = { id: first.json.id, country: "CO", currency: "COP", amountMinor: 5_000_000, days: 7, limits: LIMITS_CO };
    expect((await call("GET", "/v1/me/payment-requests", authorization)).json.requests[0]).toMatchObject(snapshot);
    expect(await create(authorization, { country: "CO", plan: "weekly", idempotencyKey })).toMatchObject({ status: 200, json: snapshot });

    expect((await saveCatalog({ ...changed, enabled: false })).status).toBe(200);
    expect(await create(authorization, { country: "CO", plan: "weekly", idempotencyKey })).toMatchObject({ status: 200, json: snapshot });
    // Misma clave con otro país u otro plan: conflicto, nunca otra solicitud.
    expect((await create(authorization, { country: "JE", plan: "weekly", idempotencyKey })).status).toBe(409);
    expect((await create(authorization, { country: "CO", plan: "monthly", idempotencyKey })).status).toBe(409);
    expect(await requestCount("uid-snapshot")).toBe(1);
  });

  it("una sola pendiente por usuario en todos los países", async () => {
    await start();
    expect((await saveCatalog(CATALOG)).status).toBe(200);
    const authorization = await user("uid-una");
    expect((await create(authorization, { country: "CO", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() })).status).toBe(201);
    const other = await create(authorization, { country: "JE", plan: "weekly", idempotencyKey: globalThis.crypto.randomUUID() });
    expect(other.status).toBe(409);
    expect(other.json).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await requestCount("uid-una")).toBe(1);
  });

  it("el historial anterior sin país se muestra con country null, sin inventarle uno", async () => {
    await start();
    const authorization = await user("uid-historial");
    const id = "40000000-0000-4000-8000-000000000004";
    await db
      .prepare(
        `INSERT INTO payment_requests (id, uid, plan, amount_minor, currency, status, idempotency_key, created_at, decided_at, days,
           max_requests, max_chars)
         VALUES (?1, 'uid-historial', 'weekly', 100, 'EUR', 'rejected', ?1, ?2, ?2, 7, 5, 1000)`,
      )
      .bind(id, Date.now())
      .run();
    const mine = await call("GET", "/v1/me/payment-requests", authorization);
    expect(mine.status).toBe(200);
    expect(mine.json.requests).toEqual([expect.objectContaining({ id, country: null, currency: "EUR", amountMinor: 100 })]);
    const admin = await call("GET", "/v1/admin/payment-requests", owner);
    expect(admin.json.requests.find((item) => item.id === id)).toMatchObject({ country: null });
  });
});

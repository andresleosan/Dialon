// Integración en workerd REAL (Miniflare) con D1 y R2 LOCALES en memoria: registro de usuarios, suscripciones
// manuales, cuota atómica, ajustes del propietario y selección Sarin/DeepSeek. Todo el tráfico saliente pasa por
// `outboundService`: solo el JWKS de prueba, un Sarin SIMULADO y un DeepSeek SIMULADO; cualquier otro host hace fallar la
// prueba. Tokens sintéticos y uid de propietario ficticio: nada real, nada remoto, ningún coste.
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
const SARIN_URL = "https://ia-sarin.alsdevstudio.com/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const OWNER_EMAIL = "andres.san1404@gmail.com";
const OWNER_UID = "uid-propietario-ficticio";
const DEEPSEEK_KEY = "clave-deepseek-sintetica";
const DAY = 86_400_000;

const key = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(key.publicKey)), kid: "kid-prueba", alg: "RS256", use: "sig" }] };

const outbound = { sarin: [], deepseek: [], unexpected: [] };
let deepseekStatus = 200;

function completion(content) {
  return JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
}

async function handleOutbound(request) {
  if (request.url === JWKS_URL) {
    return new globalThis.Response(JSON.stringify(jwks), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }
  if (request.url === SARIN_URL) {
    outbound.sarin.push({ body: JSON.parse(await request.text()) });
    return new globalThis.Response(completion("Hello (sarin)"), { headers: { "Content-Type": "application/json" } });
  }
  if (request.url === DEEPSEEK_URL) {
    outbound.deepseek.push({ authorization: request.headers.get("Authorization"), body: JSON.parse(await request.text()) });
    if (deepseekStatus !== 200) return new globalThis.Response("fallo interno simulado", { status: deepseekStatus });
    return new globalThis.Response(completion("Hello (deepseek)"), { headers: { "Content-Type": "application/json" } });
  }
  outbound.unexpected.push(request.url);
  return new globalThis.Response("host inesperado", { status: 599 });
}

async function token(sub, { email = `${sub}@example.com`, verified = true } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: now - 60, email, email_verified: verified })
    .setProtectedHeader({ alg: "RS256", kid: "kid-prueba" })
    .setIssuer("https://securetoken.google.com/dialonapp")
    .setAudience("dialonapp")
    .setSubject(sub)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 3000)
    .sign(key.privateKey);
}

const ownerToken = () => token(OWNER_UID, { email: OWNER_EMAIL });

async function worker(bindings) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: bundle,
      compatibilityDate: "2026-10-06",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        ALLOWED_ORIGINS: "https://dialon.pages.dev,http://localhost:8081",
        OWNER_EMAIL,
        OWNER_FIREBASE_UID: OWNER_UID,
        ...bindings,
      },
      d1Databases: ["DB"],
      r2Buckets: ["PROOFS"],
      ratelimits: { TRANSLATE_LIMITER: { namespace_id: "4100", simple: { limit: 100, period: 60 } } },
      outboundService: handleOutbound,
    }),
  );
  await mf.ready;
  await applyMigrations(mf, migrations);
  return mf;
}

async function call(mf, method, path, authorization, body) {
  const response = await mf.dispatchFetch(`https://api.example${path}`, {
    method,
    headers: {
      Origin: "https://dialon.pages.dev",
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json };
}

function translate(mf, authorization, extra = {}) {
  return call(mf, "POST", "/v1/translate", authorization, {
    requestId: globalThis.crypto.randomUUID(),
    source: "es",
    target: "en",
    text: "Hola",
    ...extra,
  });
}

async function activate(mf, uid, limits = { maxRequests: 10, maxChars: 10_000 }, status = "active") {
  return call(mf, "PUT", `/v1/admin/users/${uid}/subscription`, await ownerToken(), {
    status,
    plan: "monthly",
    expiresAt: Date.now() + 30 * DAY,
    limits,
  });
}

/** Registra un usuario nuevo (GET /v1/me) y devuelve su token. */
async function newUser(mf, uid) {
  const authorization = await token(uid);
  const me = await call(mf, "GET", "/v1/me", authorization);
  expect(me.status).toBe(200);
  return authorization;
}

describe("Administración manual en workerd con D1/R2 locales", () => {
  let mf;

  beforeAll(async () => {
    expect(existsSync(bundle)).toBe(true);
    mf = await worker({ SARIN_AUTH_MODE: "none", DEEPSEEK_API_KEY: DEEPSEEK_KEY, DEEPSEEK_MODEL: "deepseek-flash" });
  });

  afterAll(async () => {
    await mf?.dispose();
  });

  afterEach(() => {
    expect(outbound.unexpected).toEqual([]);
  });

  it("GET /v1/me registra al usuario sin acceso por defecto, con pagos desactivados; el propietario se reconoce solo por backend", async () => {
    const me = await call(mf, "GET", "/v1/me", await token("uid-nuevo"));
    expect(me.status).toBe(200);
    expect(me.headers.get("Cache-Control")).toBe("no-store");
    expect(me.json).toMatchObject({ uid: "uid-nuevo", role: "user", subscription: { status: "inactive" }, payments: { enabled: false } });

    const owner = await call(mf, "GET", "/v1/me", await ownerToken());
    expect(owner.status).toBe(200);
    expect(owner.json).toMatchObject({ uid: OWNER_UID, role: "owner" });

    const unverified = await call(mf, "GET", "/v1/me", await token(OWNER_UID, { email: OWNER_EMAIL, verified: false }));
    expect(unverified.json).toMatchObject({ role: "user" });
  });

  it("el propietario lista usuarios registrados; un usuario no puede", async () => {
    await newUser(mf, "uid-listado");
    const list = await call(mf, "GET", "/v1/admin/users", await ownerToken());
    expect(list.status).toBe(200);
    expect(list.json.users).toEqual(
      expect.arrayContaining([expect.objectContaining({ uid: "uid-listado", subscription: expect.objectContaining({ status: "inactive" }) })]),
    );
    expect((await call(mf, "GET", "/v1/admin/users", await token("uid-listado"))).status).toBe(403);
  });

  it("sin suscripción activa no se traduce: 403 SUBSCRIPTION_REQUIRED y ninguna llamada al proveedor", async () => {
    const authorization = await newUser(mf, "uid-sin-plan");
    const before = outbound.sarin.length;
    const response = await translate(mf, authorization);
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ error: { code: "SUBSCRIPTION_REQUIRED" } });
    expect(outbound.sarin.length).toBe(before);
  });

  it("el propietario activa una suscripción con límites; la cuota se consume y al agotarse da 429 QUOTA_EXCEEDED sin llamar", async () => {
    const authorization = await newUser(mf, "uid-cuota");
    expect((await activate(mf, "uid-cuota", { maxRequests: 1, maxChars: 1000 })).status).toBe(200);
    const before = outbound.sarin.length;
    const first = await translate(mf, authorization);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ translation: "Hello (sarin)", mode: "real" });
    const second = await translate(mf, authorization);
    expect(second.status).toBe(429);
    expect(second.json).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });
    expect(outbound.sarin.length).toBe(before + 1);
    const me = await call(mf, "GET", "/v1/me", authorization);
    expect(me.json.subscription).toMatchObject({ status: "active", usage: { requests: 1, chars: 4 } });
  });

  it("la reserva de cuota es atómica: con una petición disponible, dos en paralelo dan exactamente un 200 y un 429", async () => {
    const authorization = await newUser(mf, "uid-paralelo");
    await activate(mf, "uid-paralelo", { maxRequests: 1, maxChars: 1000 });
    const before = outbound.sarin.length;
    const statuses = (await Promise.all([translate(mf, authorization), translate(mf, authorization)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429]);
    expect(outbound.sarin.length).toBe(before + 1);
  });

  it("una suscripción suspendida no traduce; límites fuera de los topes o vencimiento pasado se rechazan con 400", async () => {
    const authorization = await newUser(mf, "uid-suspendido");
    expect((await activate(mf, "uid-suspendido", { maxRequests: 5, maxChars: 1000 }, "suspended")).status).toBe(200);
    expect((await translate(mf, authorization)).json).toMatchObject({ error: { code: "SUBSCRIPTION_REQUIRED" } });

    const owner = await ownerToken();
    const base = { status: "active", plan: "monthly", expiresAt: Date.now() + DAY, limits: { maxRequests: 5, maxChars: 1000 } };
    for (const bad of [
      { ...base, limits: { maxRequests: 100_001, maxChars: 1000 } },
      { ...base, limits: { maxRequests: 5, maxChars: 10_000_001 } },
      { ...base, expiresAt: Date.now() - DAY },
      { ...base, expiresAt: Date.now() + 401 * DAY },
      { ...base, status: "gratis" },
      { ...base, extra: true },
    ]) {
      expect((await call(mf, "PUT", "/v1/admin/users/uid-suspendido/subscription", owner, bad)).status).toBe(400);
    }
  });

  it("ajustes por defecto: Sarin, externos desactivados y pagos desactivados con datos vacíos; DeepSeek no se guarda sin externos", async () => {
    const owner = await ownerToken();
    const settings = await call(mf, "GET", "/v1/admin/settings", owner);
    expect(settings.status).toBe(200);
    expect(settings.json.translation).toEqual({ activeProvider: "sarin", externalProvidersEnabled: false });
    // Catálogo por país apagado y vacío: sin tarifa global, precios ni datos bancarios por defecto.
    expect(settings.json.payments).toEqual({ enabled: false, markets: [] });

    const rejected = await call(mf, "PUT", "/v1/admin/settings", owner, { translation: { activeProvider: "deepseek", externalProvidersEnabled: false } });
    expect(rejected.status).toBe(400);
    const noData = await call(mf, "PUT", "/v1/admin/settings", owner, {
      payments: { enabled: true, currency: "", instructions: "", prices: { weekly: "", biweekly: "", monthly: "" } },
    });
    expect(noData.status).toBe(400);
    const emptyCatalog = await call(mf, "PUT", "/v1/admin/settings", owner, { payments: { enabled: true, markets: [] } });
    expect(emptyCatalog.status).toBe(400);
  });

  it("estado de proveedores: distingue configurado y no verificado, y nunca hace peticiones salientes", async () => {
    const owner = await ownerToken();
    const before = { sarin: outbound.sarin.length, deepseek: outbound.deepseek.length };
    const status = await call(mf, "GET", "/v1/admin/status", owner);
    expect(status.status).toBe(200);
    expect(status.json.providers.deepseek).toMatchObject({ configured: true, state: "unverified" });
    expect(status.json.providers.sarin).toMatchObject({ configured: true });
    expect({ sarin: outbound.sarin.length, deepseek: outbound.deepseek.length }).toEqual(before);
  });

  it("con DeepSeek activo: sin consentimiento 403 CONSENT_REQUIRED; con él, URL, modelo y thinking fijos; si falla, sin fallback a Sarin", async () => {
    const owner = await ownerToken();
    const saved = await call(mf, "PUT", "/v1/admin/settings", owner, { translation: { activeProvider: "deepseek", externalProvidersEnabled: true } });
    expect(saved.status).toBe(200);
    const authorization = await newUser(mf, "uid-deepseek");
    await activate(mf, "uid-deepseek");
    const sarinBefore = outbound.sarin.length;
    const deepseekBefore = outbound.deepseek.length;

    const noConsent = await translate(mf, authorization);
    expect(noConsent.status).toBe(403);
    expect(noConsent.json).toMatchObject({ error: { code: "CONSENT_REQUIRED" } });
    expect(outbound.deepseek.length).toBe(deepseekBefore);

    const chosen = await translate(mf, authorization, { externalProcessingConsent: true, provider: "sarin" });
    expect(chosen.status).toBe(400);

    const ok = await translate(mf, authorization, { externalProcessingConsent: true });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ translation: "Hello (deepseek)" });
    const sent = outbound.deepseek.at(-1);
    expect(sent.authorization).toBe(`Bearer ${DEEPSEEK_KEY}`);
    expect(sent.body).toMatchObject({ model: "deepseek-flash", stream: false, thinking: { type: "disabled" } });

    deepseekStatus = 500;
    try {
      const failed = await translate(mf, authorization, { externalProcessingConsent: true });
      expect(failed.status).toBe(502);
      expect(JSON.stringify(failed.json)).not.toContain("fallo interno simulado");
    } finally {
      deepseekStatus = 200;
    }
    expect(outbound.sarin.length).toBe(sarinBefore);

    const status = await call(mf, "GET", "/v1/admin/status", owner);
    expect(status.json.providers.deepseek).toMatchObject({ state: "verified" });
    await call(mf, "PUT", "/v1/admin/settings", owner, { translation: { activeProvider: "sarin", externalProvidersEnabled: false } });
  });
});

describe("DeepSeek sin Sarin configurado, y modelo fuera de la lista", () => {
  afterEach(() => {
    expect(outbound.unexpected).toEqual([]);
  });

  it("sin SARIN_AUTH_MODE, /v1/me y la administración funcionan y DeepSeek traduce con consentimiento", async () => {
    const mf = await worker({ DEEPSEEK_API_KEY: DEEPSEEK_KEY, DEEPSEEK_MODEL: "deepseek-v4-pro" });
    try {
      const owner = await ownerToken();
      expect((await call(mf, "GET", "/v1/me", owner)).status).toBe(200);
      expect((await call(mf, "PUT", "/v1/admin/settings", owner, { translation: { activeProvider: "deepseek", externalProvidersEnabled: true } })).status).toBe(200);
      const authorization = await newUser(mf, "uid-solo-deepseek");
      await activate(mf, "uid-solo-deepseek");
      const ok = await translate(mf, authorization, { externalProcessingConsent: true });
      expect(ok.status).toBe(200);
      expect(outbound.deepseek.at(-1).body).toMatchObject({ model: "deepseek-v4-pro" });
    } finally {
      await mf.dispose();
    }
  });

  it("un DEEPSEEK_MODEL fuera de la lista deja DeepSeek sin configurar: 503 sin llamada", async () => {
    const mf = await worker({ DEEPSEEK_API_KEY: DEEPSEEK_KEY, DEEPSEEK_MODEL: "deepseek-chat-cualquiera" });
    try {
      const owner = await ownerToken();
      expect((await call(mf, "GET", "/v1/admin/status", owner)).json?.providers?.deepseek).toMatchObject({ configured: false, state: "not_configured" });
      await call(mf, "PUT", "/v1/admin/settings", owner, { translation: { activeProvider: "deepseek", externalProvidersEnabled: true } });
      const authorization = await newUser(mf, "uid-modelo-malo");
      await activate(mf, "uid-modelo-malo");
      const before = outbound.deepseek.length;
      const response = await translate(mf, authorization, { externalProcessingConsent: true });
      expect(response.status).toBe(503);
      expect(outbound.deepseek.length).toBe(before);
    } finally {
      await mf.dispose();
    }
  });
});

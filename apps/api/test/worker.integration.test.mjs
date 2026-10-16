// Integración en workerd REAL (Miniflare) sobre el bundle de `wrangler deploy --dry-run`. Todo el tráfico saliente
// pasa por `outboundService`: solo responden el JWKS de prueba (con la URL oficial de Google) y un Sarin SIMULADO;
// cualquier otro host se registra y hace fallar la prueba. Nada sale a la red y nada de esto verifica Sarin real.
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
// Propietario ficticio solo para sembrar suscripciones en la D1 local de la prueba.
const OWNER_UID = "uid-propietario-ficticio";
const OWNER_EMAIL = "andres.san1404@gmail.com";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const SARIN_URL = "https://ia-sarin.alsdevstudio.com/v1/chat/completions";
const ID = "6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f809a1b";

const key = await generateKeyPair("RS256", { extractable: true });
const other = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(key.publicKey)), kid: "kid-prueba", alg: "RS256", use: "sig" }] };

const outbound = { jwks: 0, sarin: [], unexpected: [] };

async function handleOutbound(request) {
  if (request.url === JWKS_URL) {
    outbound.jwks += 1;
    return new globalThis.Response(JSON.stringify(jwks), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }
  if (request.url === SARIN_URL) {
    outbound.sarin.push({ authorization: request.headers.get("Authorization"), body: JSON.parse(await request.text()) });
    const content = "Olá, tudo bem?";
    return new globalThis.Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  outbound.unexpected.push(request.url);
  return new globalThis.Response("host inesperado", { status: 599 });
}

async function token(sub, signingKey = key.privateKey, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: now - 60, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "kid-prueba" })
    .setIssuer("https://securetoken.google.com/dialonapp")
    .setAudience("dialonapp")
    .setSubject(sub)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 3000)
    .sign(signingKey);
}

function worker(bindings) {
  return new Miniflare(
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
      ratelimits: { TRANSLATE_LIMITER: { namespace_id: "4100", simple: { limit: 2, period: 60 } } },
      outboundService: handleOutbound,
    }),
  );
}

/** Registra al usuario y el propietario (ficticio) le activa una suscripción en la D1 local. */
async function subscribe(mf, sub) {
  const call = async (method, path, authorization, body) =>
    mf.dispatchFetch(`https://api.example${path}`, {
      method,
      headers: { Authorization: `Bearer ${authorization}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  expect((await call("GET", "/v1/me", await token(sub))).status).toBe(200);
  const owner = await token(OWNER_UID, key.privateKey, { email: OWNER_EMAIL, email_verified: true });
  const activated = await call("PUT", `/v1/admin/users/${sub}/subscription`, owner, {
    status: "active",
    plan: "monthly",
    expiresAt: Date.now() + 30 * 86_400_000,
    limits: { maxRequests: 50, maxChars: 100_000 },
  });
  expect(activated.status).toBe(200);
}

function translate(mf, authorization, body = { requestId: ID, source: "es", target: "pt", text: "Hola, ¿qué tal?" }) {
  return mf.dispatchFetch("https://api.example/v1/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization, Origin: "https://dialon.pages.dev" },
    body: JSON.stringify(body),
  });
}

describe("Worker en workerd real", () => {
  let configured;

  beforeAll(async () => {
    expect(existsSync(bundle)).toBe(true);
    configured = worker({ SARIN_AUTH_MODE: "bearer", SARIN_API_KEY: "clave-de-prueba" });
    await configured.ready;
    await applyMigrations(configured, migrations);
    await subscribe(configured, "uid-ana");
    await subscribe(configured, "uid-limite");
  });

  afterAll(async () => {
    await configured?.dispose();
  });

  afterEach(() => {
    expect(outbound.unexpected).toEqual([]);
  });

  it("con un token válido verifica la firma con el JWKS, llama a Sarin una vez con URL/modelo fijos y devuelve el resultado", async () => {
    const before = outbound.sarin.length;
    const response = await translate(configured, `Bearer ${await token("uid-ana")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ requestId: ID, translation: "Olá, tudo bem?", mode: "real" });
    expect(outbound.jwks).toBe(1);
    expect(outbound.sarin.length).toBe(before + 1);
    const call = outbound.sarin.at(-1);
    expect(call.authorization).toBe("Bearer clave-de-prueba");
    expect(call.body).toMatchObject({ model: "qwen3.8:27b-q4_K_M", stream: false });
  });

  it("un token firmado con otra clave da 401 y no llega a Sarin", async () => {
    const before = outbound.sarin.length;
    const response = await translate(configured, `Bearer ${await token("uid-ana", other.privateKey)}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(outbound.sarin.length).toBe(before);
  });

  it("el binding real de límite corta al superar el máximo por uid con 429 y sin llamar a Sarin", async () => {
    const authorization = `Bearer ${await token("uid-limite")}`;
    expect((await translate(configured, authorization)).status).toBe(200);
    expect((await translate(configured, authorization)).status).toBe(200);
    const before = outbound.sarin.length;
    const limited = await translate(configured, authorization);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(outbound.sarin.length).toBe(before);
  });

  it("sin SARIN_AUTH_MODE falla cerrado con 503 y ninguna petición saliente", async () => {
    const unconfigured = worker({});
    try {
      await unconfigured.ready;
      const jwksBefore = outbound.jwks;
      const sarinBefore = outbound.sarin.length;
      const response = await translate(unconfigured, `Bearer ${await token("uid-ana")}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
      expect(outbound.jwks).toBe(jwksBefore);
      expect(outbound.sarin.length).toBe(sarinBefore);
    } finally {
      await unconfigured.dispose();
    }
  });
});

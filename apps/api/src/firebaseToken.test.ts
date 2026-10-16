import { exportJWK, generateKeyPair, SignJWT, type JWK, type JSONWebKeySet } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  createFirebaseVerifier,
  fetchGoogleKeys,
  FIREBASE_JWKS_URL,
  type KeySet,
} from "./firebaseToken";

// Claves RSA reales generadas en memoria para cada ejecución: nada persistente, ninguna credencial real.

const PROJECT = "dialonapp";
const NOW = 1_800_000_000_000; // ms
const NOW_S = NOW / 1000;

async function rsaKey(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  return { privateKey, jwk };
}

const main = await rsaKey("kid-main");
const other = await rsaKey("kid-other");
const rotated = await rsaKey("kid-rotated");

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: "uid-ana",
    iat: NOW_S - 60,
    exp: NOW_S + 3000,
    auth_time: NOW_S - 120,
    ...overrides,
  };
}

async function sign(
  payload: Record<string, unknown> = claims(),
  // `kid: null` omite la cabecera (con `undefined` se aplicaría el valor por defecto).
  { key = main.privateKey, kid = "kid-main" }: { key?: typeof main.privateKey; kid?: string | null } = {},
) {
  const header = kid === null ? { alg: "RS256" } : { alg: "RS256", kid };
  return new SignJWT(payload).setProtectedHeader(header).sign(key);
}

function keySet(keys: JWK[], expiresAt = NOW + 3_600_000): KeySet {
  const set: JSONWebKeySet = { keys };
  return { keys: set, expiresAt };
}

type LoadKeys = (signal: AbortSignal) => Promise<KeySet>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function verifier(load = vi.fn<LoadKeys>(() => Promise.resolve(keySet([main.jwk]))), now = () => NOW) {
  return { load, verifier: createFirebaseVerifier({ loadKeys: load, now }) };
}

const signal = () => new AbortController().signal;

describe("verificación del Firebase ID token", () => {
  it("un token RS256 válido del proyecto devuelve el uid de su sub", async () => {
    const { verifier: v } = verifier();
    await expect(v.verify(`Bearer ${await sign()}`, signal())).resolves.toEqual({ ok: true, uid: "uid-ana", emailVerified: false });
  });

  it("rechaza la firma de otra clave, el token sin kid y alg HS256", async () => {
    const { verifier: v } = verifier();
    const hs = await new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256", kid: "kid-main" })
      .sign(new TextEncoder().encode("x".repeat(32)));
    for (const token of [await sign(claims(), { key: other.privateKey }), await sign(claims(), { kid: null }), hs]) {
      await expect(v.verify(`Bearer ${token}`, signal())).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
    }
  });

  it("aud o iss de otro proyecto, iat o auth_time futuros, auth_time ausente o no numérico y sub inválido se rechazan", async () => {
    const { verifier: v } = verifier();
    const bad = [
      claims({ aud: "otro-proyecto" }),
      claims({ iss: "https://securetoken.google.com/otro-proyecto" }),
      claims({ iat: NOW_S + 600 }),
      claims({ auth_time: NOW_S + 600 }),
      claims({ auth_time: undefined }),
      claims({ auth_time: "ayer" }),
      claims({ sub: "" }),
      claims({ sub: "u".repeat(129) }),
    ];
    for (const payload of bad) {
      await expect(v.verify(`Bearer ${await sign(payload)}`, signal())).resolves.toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
    }
  });

  it("un token caducado da TOKEN_EXPIRED", async () => {
    const { verifier: v } = verifier();
    const expired = await sign(claims({ iat: NOW_S - 7200, exp: NOW_S - 3600 }));
    await expect(v.verify(`Bearer ${expired}`, signal())).resolves.toEqual({ ok: false, code: "TOKEN_EXPIRED" });
  });

  it("sin cabecera Bearer bien formada no descarga claves", async () => {
    const { load, verifier: v } = verifier();
    for (const header of [null, "", "Basic abc", "Bearer a.b", `Bearer ${"a".repeat(4100)}.b.c`, "Bearer  a.b.c"]) {
      await expect(v.verify(header, signal())).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
    }
    expect(load).not.toHaveBeenCalled();
  });
});

describe("claves de Google: caché, rotación y fallos", () => {
  it("dos verificaciones simultáneas descargan las claves una sola vez y la caché sirve hasta que caduca", async () => {
    let now = NOW;
    const load = vi.fn<LoadKeys>(() => Promise.resolve(keySet([main.jwk], now + 60_000)));
    const v = createFirebaseVerifier({ loadKeys: load, now: () => now });
    const token = `Bearer ${await sign()}`;
    await Promise.all([v.verify(token, signal()), v.verify(token, signal())]);
    expect(load).toHaveBeenCalledTimes(1);
    await v.verify(token, signal());
    expect(load).toHaveBeenCalledTimes(1);
    now += 61_000;
    await v.verify(`Bearer ${await sign(claims({ iat: Math.floor(now / 1000) - 10, exp: Math.floor(now / 1000) + 3000 }))}`, signal());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("un kid nuevo provoca una sola recarga (rotación); otro kid desconocido dentro del enfriamiento no recarga", async () => {
    const load = vi
      .fn<LoadKeys>(() => Promise.resolve(keySet([main.jwk])))
      .mockResolvedValueOnce(keySet([main.jwk]))
      .mockResolvedValueOnce(keySet([main.jwk, rotated.jwk]));
    const v = createFirebaseVerifier({ loadKeys: load, now: () => NOW });
    await v.verify(`Bearer ${await sign()}`, signal());
    const rotatedToken = await sign(claims(), { key: rotated.privateKey, kid: "kid-rotated" });
    await expect(v.verify(`Bearer ${rotatedToken}`, signal())).resolves.toEqual({ ok: true, uid: "uid-ana", emailVerified: false });
    expect(load).toHaveBeenCalledTimes(2);
    const unknown = await sign(claims(), { key: other.privateKey, kid: "kid-desconocido" });
    await expect(v.verify(`Bearer ${unknown}`, signal())).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("si las claves no se pueden descargar, falla con SERVICE_UNAVAILABLE y nunca usa claves caducadas", async () => {
    let now = NOW;
    const load = vi
      .fn<LoadKeys>(() => Promise.reject(new Error("sin red")))
      .mockResolvedValueOnce(keySet([main.jwk], NOW + 1000));
    const v = createFirebaseVerifier({ loadKeys: load, now: () => now });
    await expect(v.verify(`Bearer ${await sign()}`, signal())).resolves.toEqual({ ok: true, uid: "uid-ana", emailVerified: false });
    now += 2000;
    await expect(v.verify(`Bearer ${await sign()}`, signal())).resolves.toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("si la petición se cancela mientras se descargan las claves, responde TIMEOUT sin esperar", async () => {
    const load = vi.fn<LoadKeys>(() => new Promise<KeySet>(() => undefined));
    const v = createFirebaseVerifier({ loadKeys: load, now: () => NOW });
    await expect(v.verify(`Bearer ${await sign()}`, AbortSignal.timeout(20))).resolves.toEqual({
      ok: false,
      code: "TIMEOUT",
    });
  });
});

describe("fetchGoogleKeys", () => {
  const JWKS = JSON.stringify({ keys: [main.jwk] });

  function respond(body: string, headers: Record<string, string> = {}, status = 200) {
    return vi.fn<Fetch>(() => Promise.resolve(new Response(body, { status, headers })));
  }

  it("descarga el JWKS oficial con GET, sin seguir redirecciones, y caduca según max-age menos Age", async () => {
    const fetchFn = respond(JWKS, { "Cache-Control": "public, max-age=600, must-revalidate", Age: "100" });
    const result = await fetchGoogleKeys(fetchFn, signal(), () => NOW);
    expect(fetchFn).toHaveBeenCalledWith(FIREBASE_JWKS_URL, expect.objectContaining({ method: "GET", redirect: "manual" }));
    expect(FIREBASE_JWKS_URL).toBe(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    );
    expect(result.expiresAt).toBe(NOW + 500_000);
    expect(result.keys.keys).toHaveLength(1);
  });

  it("no-store, no-cache o sin Cache-Control caducan al momento; un max-age enorme se limita a 24 h", async () => {
    for (const cacheControl of ["no-store", "no-cache, max-age=600", undefined]) {
      const headers: Record<string, string> = cacheControl === undefined ? {} : { "Cache-Control": cacheControl };
      expect((await fetchGoogleKeys(respond(JWKS, headers), signal(), () => NOW)).expiresAt).toBe(NOW);
    }
    const capped = await fetchGoogleKeys(respond(JWKS, { "Cache-Control": "max-age=999999" }), signal(), () => NOW);
    expect(capped.expiresAt).toBe(NOW + 86_400_000);
  });

  it("rechaza estados distintos de 200, redirecciones, JSON inválido, forma inesperada y cuerpos de más de 32 KiB", async () => {
    const failures = [
      respond(JWKS, {}, 500),
      respond("", { Location: "https://otro.example" }, 302),
      respond("<html>", {}),
      respond(JSON.stringify({ claves: [] })),
      respond(JSON.stringify({ keys: [main.jwk], relleno: "x".repeat(33 * 1024) })),
    ];
    for (const fetchFn of failures) await expect(fetchGoogleKeys(fetchFn, signal(), () => NOW)).rejects.toThrow();
  });

  it("si la señal se cancela, la descarga se aborta", async () => {
    const fetchFn = vi.fn<Fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("abortado"));
          });
        }),
    );
    await expect(fetchGoogleKeys(fetchFn, AbortSignal.timeout(20), () => NOW)).rejects.toThrow();
  });
});

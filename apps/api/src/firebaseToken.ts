import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { parseJson, readBoundedText } from "./http";

// Verificación criptográfica real del Firebase ID token (RS256 + kid) contra el JWKS oficial de Google. Sin Admin SDK:
// un usuario deshabilitado o un token revocado se aceptan hasta su `exp` (≤ 1 h). Nunca se decodifica sin verificar.

export const FIREBASE_PROJECT_ID = "dialonapp";
export const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_HEADER_CHARS = 4096;
const CLOCK_TOLERANCE_S = 5;
const KEYS_TIMEOUT_MS = 5000;
const KEYS_MAX_BYTES = 32 * 1024;
const MAX_TTL_S = 86_400;
const RELOAD_COOLDOWN_MS = 60_000;

export interface KeySet {
  readonly keys: JSONWebKeySet;
  /** Instante (ms) a partir del cual estas claves ya no se usan. */
  readonly expiresAt: number;
}

/**
 * Identidad sacada SOLO de claims ya verificados. `email` aparece únicamente si es un string; `emailVerified` es `true`
 * solo si el claim `email_verified` es exactamente `true`.
 */
export type TokenOutcome =
  | { readonly ok: true; readonly uid: string; readonly email?: string; readonly emailVerified?: boolean }
  | { readonly ok: false; readonly code: "UNAUTHENTICATED" | "TOKEN_EXPIRED" | "SERVICE_UNAVAILABLE" | "TIMEOUT" };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Segundos que el JWKS se puede reutilizar: `max-age` menos `Age`; `no-store`/`no-cache` o sin cabecera → 0. */
function ttlSeconds(cacheControl: string | null, age: string | null): number {
  if (cacheControl === null || /(^|,)\s*(no-store|no-cache)\b/i.test(cacheControl)) return 0;
  const maxAge = /(^|,)\s*max-age=(\d+)/i.exec(cacheControl)?.[2];
  if (maxAge === undefined) return 0;
  const elapsed = age !== null && /^\d+$/.test(age.trim()) ? Number(age.trim()) : 0;
  return Math.min(MAX_TTL_S, Math.max(0, Number(maxAge) - elapsed));
}

function isKeySet(value: unknown): value is JSONWebKeySet {
  return typeof value === "object" && value !== null && Array.isArray((value as { keys?: unknown }).keys);
}

/** Descarga acotada (≤ 32 KiB, ≤ 5 s, sin seguir redirecciones) del JWKS oficial. Lanza si algo no encaja. */
export async function fetchGoogleKeys(fetchFn: Fetch, signal: AbortSignal, now: () => number = Date.now): Promise<KeySet> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(KEYS_TIMEOUT_MS)]);
  const response = await fetchFn(FIREBASE_JWKS_URL, { method: "GET", redirect: "manual", signal: deadline });
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("JWKS no disponible");
  }
  const parsed = parseJson(await readBoundedText(response.body, KEYS_MAX_BYTES, deadline));
  if (!isKeySet(parsed)) throw new Error("JWKS con forma inesperada");
  const ttl = ttlSeconds(response.headers.get("Cache-Control"), response.headers.get("Age"));
  return { keys: parsed, expiresAt: now() + ttl * 1000 };
}

/** Espera `promise` pero rechaza en cuanto se cancela `signal`. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("cancelado"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("cancelado"));
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

// El guard conserva el resto del payload (email, email_verified…): solo añade que `sub` es un string válido.
function validClaims(payload: JWTPayload, nowS: number): payload is JWTPayload & { sub: string } {
  const { sub, iat, exp, auth_time: authTime } = payload;
  const numeric = [iat, exp, authTime].every((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric) return false;
  if ((iat as number) > nowS + CLOCK_TOLERANCE_S || (authTime as number) > nowS + CLOCK_TOLERANCE_S) return false;
  return typeof sub === "string" && sub.length > 0 && sub.length <= 128;
}

/**
 * Verificador con caché de claves en memoria del isolate: respeta `max-age`, una sola descarga en vuelo, y ante un
 * `kid` desconocido una única recarga cada 60 s. Si no hay claves vigentes y no se pueden descargar → 503; nunca usa
 * claves caducadas.
 */
export function createFirebaseVerifier({
  loadKeys,
  now = Date.now,
}: {
  readonly loadKeys: (signal: AbortSignal) => Promise<KeySet>;
  readonly now?: () => number;
}) {
  let cached: KeySet | undefined;
  let inflight: Promise<KeySet> | undefined;
  // Última recarga forzada por un kid desconocido (el enfriamiento solo cuenta entre esas).
  let lastForced = Number.NEGATIVE_INFINITY;

  function refresh(): Promise<KeySet> {
    inflight ??= (async () => {
      try {
        cached = await loadKeys(AbortSignal.timeout(KEYS_TIMEOUT_MS));
        return cached;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  function currentKeys(): Promise<KeySet> {
    return cached !== undefined && cached.expiresAt > now() ? Promise.resolve(cached) : refresh();
  }

  async function check(token: string, keys: KeySet): Promise<TokenOutcome> {
    const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(keys.keys), {
      algorithms: ["RS256"],
      issuer: ISSUER,
      audience: FIREBASE_PROJECT_ID,
      requiredClaims: ["exp", "iat", "auth_time", "sub"],
      clockTolerance: CLOCK_TOLERANCE_S,
      currentDate: new Date(now()),
    });
    if (typeof protectedHeader.kid !== "string" || !validClaims(payload, now() / 1000)) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const emailVerified = payload.email_verified === true;
    const { email } = payload;
    return typeof email === "string" && email.length > 0 && email.length <= 320
      ? { ok: true, uid: payload.sub, email, emailVerified }
      : { ok: true, uid: payload.sub, emailVerified };
  }

  async function verify(authorization: string | null, signal: AbortSignal): Promise<TokenOutcome> {
    if (authorization === null || authorization.length > MAX_HEADER_CHARS) return { ok: false, code: "UNAUTHENTICATED" };
    const token = BEARER.exec(authorization)?.[1];
    if (token === undefined) return { ok: false, code: "UNAUTHENTICATED" };
    try {
      let keys = await untilAborted(currentKeys(), signal);
      try {
        return await check(token, keys);
      } catch (error) {
        // Rotación: un kid desconocido permite una sola recarga, y como mucho una cada 60 s.
        if (!(error instanceof errors.JWKSNoMatchingKey) || now() - lastForced < RELOAD_COOLDOWN_MS) throw error;
        lastForced = now();
        keys = await untilAborted(refresh(), signal);
        return await check(token, keys);
      }
    } catch (error) {
      if (signal.aborted) return { ok: false, code: "TIMEOUT" };
      if (error instanceof errors.JWTExpired) return { ok: false, code: "TOKEN_EXPIRED" };
      if (error instanceof errors.JOSEError) return { ok: false, code: "UNAUTHENTICATED" };
      return { ok: false, code: "SERVICE_UNAVAILABLE" };
    }
  }

  return { verify };
}

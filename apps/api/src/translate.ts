import {
  createLimits,
  DEFAULT_TEXT_TRANSLATION_LIMITS,
  parseTextTranslationRequest,
  textOrigin,
  type Limits,
  type TranslationProvider,
} from "@dialon/contracts";
import { handleAccountRoute, isAccountPath } from "./accountRoutes";
import type { ChatOutcome } from "./chat";
import { deepseekConfigFrom, translateWithDeepSeek } from "./deepseek";
import type { TokenOutcome } from "./firebaseToken";
import { AbortedError, bestEffort, BodyError, guarded, parseJson, readBoundedText } from "./http";
import type { PaymentStore } from "./paymentStore";
import { baseHeaders, fail, respond, type Context } from "./respond";
import { optionalString, sarinAuthFrom, translateWithSarin } from "./sarin";
import { createD1Store, d1From, subscriptionUsable, type Store } from "./store";

const TRANSLATE_PATH = "/v1/translate";
const DEADLINE_MS = 25_000;
const MAX_BODY_BYTES = 16 * 1024;
const RETRY_AFTER_S = "60";
/** El registro del estado del proveedor es informativo: nunca retrasa la respuesta más de esto. */
const RECORD_BUDGET_MS = 250;

export interface TranslateDeps {
  readonly verifier: { verify(authorization: string | null, signal: AbortSignal): Promise<TokenOutcome> };
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Una línea por respuesta de error, sin contenido del usuario ni identificadores personales. */
  readonly log?: (line: string) => void;
  /** Persistencia; por defecto, D1 del binding `DB`. */
  readonly store?: Store;
  readonly payments?: PaymentStore;
  readonly now?: () => number;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

function allowedOrigins(env: Env): ReadonlySet<string> {
  return new Set(env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));
}

/** Catálogo del servidor: los seis por defecto o `TRANSLATION_LANGUAGES` validado. Lanza si la configuración no vale. */
function serverLimits(env: Env): Limits {
  const configured = optionalString(env, "TRANSLATION_LANGUAGES");
  if (configured === undefined) return DEFAULT_TEXT_TRANSLATION_LIMITS;
  const languages = configured.split(",").map((code) => code.trim().toLowerCase());
  return createLimits({ ...DEFAULT_TEXT_TRANSLATION_LIMITS, languages });
}

/**
 * Router del Worker: POST /v1/translate, GET /v1/me y /v1/admin/*. Orden común: ruta conocida, origen y preflight;
 * luego cada ruta verifica el token antes de hacer nada más.
 */
export async function handleRequest(request: Request, env: Env, deps: TranslateDeps): Promise<Response> {
  const started = Date.now();
  const path = new URL(request.url).pathname;
  const origin = request.headers.get("Origin");
  const origins = allowedOrigins(env);
  const cors = new Headers();
  if (origin !== null && origins.has(origin)) {
    cors.set("Access-Control-Allow-Origin", origin);
    cors.set("Vary", "Origin");
  }
  const account = isAccountPath(path);
  const context: Context = {
    cors,
    started,
    event: path === TRANSLATE_PATH ? "translate" : path.startsWith("/v1/me") ? "me" : "admin",
    log:
      deps.log ??
      ((line) => {
        console.log(line);
      }),
  };

  if (path !== TRANSLATE_PATH && !account) return fail(context, 404, "INVALID_REQUEST");
  if (origin !== null && !origins.has(origin)) return fail(context, 403, "FORBIDDEN");
  if (request.method === "OPTIONS") {
    const headers = baseHeaders(cors);
    headers.set("Access-Control-Allow-Methods", account ? "GET, POST, PUT" : "POST");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }
  if (account) return handleAccountRoute(request, env, deps, context, path);
  return translate(request, env, deps, context, started);
}

/**
 * POST /v1/translate. Orden estricto: algún proveedor configurado, token, límite por ubicación, cuerpo, suscripción
 * activa y vigente, proveedor elegido por el propietario (sin fallback), consentimiento si es externo, reserva atómica
 * de cuota y, solo entonces, una única llamada al proveedor. Todo bajo un plazo de 25 s.
 */
async function translate(request: Request, env: Env, deps: TranslateDeps, context: Context, started: number): Promise<Response> {
  if (request.method !== "POST") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "POST, OPTIONS" } });

  // Sin ningún proveedor configurado no hay nada que hacer: 503 sin verificar ni tocar la red.
  const sarinAuth = sarinAuthFrom(env);
  const deepseek = deepseekConfigFrom(env);
  if (sarinAuth.mode === "unconfigured" && deepseek === undefined) return fail(context, 503, "SERVICE_UNAVAILABLE");
  let limits: Limits;
  try {
    limits = serverLimits(env);
  } catch {
    return fail(context, 500, "INTERNAL");
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]);
  const token = await deps.verifier.verify(request.headers.get("Authorization"), signal);
  if (!token.ok) {
    if (token.code === "TIMEOUT") return fail(context, 504, "TIMEOUT");
    if (token.code === "SERVICE_UNAVAILABLE") return fail(context, 503, "SERVICE_UNAVAILABLE");
    return fail(context, 401, token.code);
  }
  const authMs = Date.now() - started;

  // Límite por ubicación (no es una cuota global: esa es la de la suscripción, en D1).
  const limiter = (env as Partial<Env>).TRANSLATE_LIMITER;
  if (!limiter) return fail(context, 503, "SERVICE_UNAVAILABLE");
  try {
    const { success } = await guarded(signal, () => limiter.limit({ key: `translate:${token.uid}` }));
    if (!success) return fail(context, 429, "RATE_LIMITED", { extra: { "Retry-After": RETRY_AFTER_S } });
  } catch (error) {
    if (error instanceof AbortedError) return fail(context, 504, "TIMEOUT");
    return fail(context, 503, "SERVICE_UNAVAILABLE");
  }

  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") ?? "")) {
    return fail(context, 415, "INVALID_REQUEST");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return fail(context, 413, "INVALID_REQUEST");
  let raw: string;
  try {
    raw = await readBoundedText(request.body, MAX_BODY_BYTES, signal);
  } catch (error) {
    if (error instanceof BodyError) return fail(context, error.reason === "too-large" ? 413 : 400, "INVALID_REQUEST");
    return fail(context, 504, "TIMEOUT");
  }
  const parsed = parseTextTranslationRequest(parseJson(raw), limits);
  if (!parsed.ok) return fail(context, 400, parsed.code === "UNSUPPORTED_LANGUAGE" ? "UNSUPPORTED_LANGUAGE" : "INVALID_REQUEST");
  const { requestId, source, target, text, externalProcessingConsent } = parsed.value;

  const db = d1From(env);
  const store = deps.store ?? (db ? createD1Store(db) : undefined);
  if (!store) return fail(context, 503, "SERVICE_UNAVAILABLE", { requestId });
  const now = deps.now?.() ?? Date.now();

  let provider: TranslationProvider;
  try {
    // Cada espera de D1 respeta la cancelación y el plazo: tras un aborto no se inicia el paso siguiente (504).
    if (!subscriptionUsable(await guarded(signal, () => store.getSubscription(token.uid)), now)) {
      return fail(context, 403, "SUBSCRIPTION_REQUIRED", { requestId });
    }
    const settings = await guarded(signal, () => store.getSettings());
    provider = settings.translation.activeProvider;
    if (provider === "deepseek") {
      if (!settings.translation.externalProvidersEnabled || deepseek === undefined) {
        return fail(context, 503, "SERVICE_UNAVAILABLE", { requestId });
      }
      // El consentimiento es por petición y solo vale `true` explícito; no elige proveedor.
      if (externalProcessingConsent !== true) return fail(context, 403, "CONSENT_REQUIRED", { requestId });
    } else if (sarinAuth.mode === "unconfigured") {
      return fail(context, 503, "SERVICE_UNAVAILABLE", { requestId });
    }
    const reservation = await guarded(signal, () => store.reserveQuota(token.uid, text.length, now));
    if (reservation === "subscription") return fail(context, 403, "SUBSCRIPTION_REQUIRED", { requestId });
    if (reservation === "quota") return fail(context, 429, "QUOTA_EXCEEDED", { requestId });
  } catch (error) {
    if (error instanceof AbortedError) return fail(context, 504, "TIMEOUT", { requestId });
    return fail(context, 503, "SERVICE_UNAVAILABLE", { requestId });
  }

  // A partir de aquí la cuota ya está consumida: si el proveedor falla, no se devuelve (puede haber costado).
  const translateStarted = Date.now();
  const input = { text, source, target, maxChars: limits.maxTextChars };
  const outcome: ChatOutcome =
    provider === "deepseek" && deepseek !== undefined
      ? await translateWithDeepSeek(input, deepseek, deps.fetch, signal)
      : await translateWithSarin(input, sarinAuth, deps.fetch, signal);
  // Informativo: como mucho 250 ms y dentro del plazo; su fallo o lentitud no cambian la respuesta.
  const recorded = provider;
  await bestEffort(signal, RECORD_BUDGET_MS, () => store.recordProvider(recorded, outcome.ok, Date.now()));
  if (!outcome.ok) {
    const status = outcome.code === "TIMEOUT" ? 504 : outcome.code === "BUSY" ? 503 : 502;
    return fail(context, status, outcome.code, { requestId, upstreamStatus: outcome.upstreamStatus });
  }
  const end = Date.now();
  context.log(JSON.stringify({ event: "translate", status: 200, requestId, upstreamStatus: outcome.upstreamStatus, ms: end - started }));
  return respond(context, 200, {
    requestId,
    translation: outcome.translation,
    mode: "real",
    timingsMs: { auth: authMs, translate: end - translateStarted, total: end - started },
    // Transparencia: qué proveedor respondió y si fue externo. Es el elegido por el propietario (sin fallback).
    ...textOrigin(provider),
  });
}

import {
  ADMIN_CAPS,
  isUid,
  parseSettingsUpdate,
  parseSubscriptionUpdate,
  publicPayments,
  type ProviderState,
} from "@dialon/contracts";
import { deepseekConfigFrom } from "./deepseek";
import type { TokenOutcome } from "./firebaseToken";
import { AbortedError, guarded } from "./http";
import { readJson, SETTINGS_BODY_BYTES } from "./jsonBody";
import { isOwner } from "./owner";
import { handleAdminPayments, handleMinePayments, isMinePaymentsPath, type PaymentContext } from "./paymentRoutes";
import type { PaymentStore } from "./paymentStore";
import { fail, respond, type Context } from "./respond";
import { sarinAuthFrom } from "./sarin";
import { createD1Store, d1From, subscriptionView, type ProviderRecord, type Store } from "./store";

// GET /v1/me, /v1/me/payment-requests* y /v1/admin/*. Para /v1/admin/* todo se deniega por defecto: primero token
// (401) y propietario (403), y solo después se resuelve la ruta (404/405), se lee el cuerpo o se toca D1/R2. Cada
// espera de D1/R2 respeta la cancelación y el plazo de 25 s (504); D1 no es cancelable por debajo, pero la petición
// no queda colgada ni inicia pasos posteriores.

const DEADLINE_MS = 25_000;
const ADMIN_PREFIX = "/v1/admin";
const SUBSCRIPTION_PATH = /^\/users\/([^/]+)\/subscription$/;

export interface AccountDeps {
  readonly verifier: { verify(authorization: string | null, signal: AbortSignal): Promise<TokenOutcome> };
  readonly store?: Store;
  readonly payments?: PaymentStore;
  readonly now?: () => number;
  /** `ExecutionContext.waitUntil` del Worker. Sin él (pruebas directas) el trabajo de fondo sigue, sin retención. */
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

type Verified = Extract<TokenOutcome, { ok: true }>;

export function isAccountPath(path: string): boolean {
  return path === "/v1/me" || isMinePaymentsPath(path) || path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`);
}

function storeOf(env: Env, deps: AccountDeps): Store | undefined {
  if (deps.store) return deps.store;
  const db = d1From(env);
  return db ? createD1Store(db) : undefined;
}

function tokenFailure(context: Context, token: Exclude<TokenOutcome, { ok: true }>): Response {
  if (token.code === "TIMEOUT") return fail(context, 504, "TIMEOUT");
  if (token.code === "SERVICE_UNAVAILABLE") return fail(context, 503, "SERVICE_UNAVAILABLE");
  return fail(context, 401, token.code);
}

function providerState(configured: boolean, record: ProviderRecord): ProviderState {
  if (!configured) return "not_configured";
  return record.lastSuccessAt === null ? "unverified" : "verified";
}

export async function handleAccountRoute(
  request: Request,
  env: Env,
  deps: AccountDeps,
  context: Context,
  path: string,
): Promise<Response> {
  const admin = path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`);
  if (path === "/v1/me" && request.method !== "GET") return fail(context, 405, "INVALID_REQUEST", { extra: { Allow: "GET, OPTIONS" } });

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]);
  const token = await deps.verifier.verify(request.headers.get("Authorization"), signal);
  if (!token.ok) return tokenFailure(context, token);
  const owner = isOwner(token, env);
  if (admin && !owner) return fail(context, 403, "FORBIDDEN");

  const store = storeOf(env, deps);
  if (!store) return fail(context, 503, "SERVICE_UNAVAILABLE");
  const now = deps.now?.() ?? Date.now();
  const waitUntil =
    deps.waitUntil ??
    ((promise: Promise<unknown>) => {
      promise.catch(() => undefined);
    });
  const payment: PaymentContext = { request, env, context, token, store, payments: deps.payments, signal, now, waitUntil };
  try {
    if (admin) {
      const rest = path.slice(ADMIN_PREFIX.length);
      return (await handleAdminPayments(payment, path)) ?? (await adminRoute(request, env, store, context, rest, token, now, signal));
    }
    if (path === "/v1/me") return await meRoute(store, context, token, owner, now, signal);
    return await handleMinePayments(payment, path);
  } catch (error) {
    if (error instanceof AbortedError || signal.aborted) return fail(context, 504, "TIMEOUT");
    return fail(context, 503, "SERVICE_UNAVAILABLE");
  }
}

async function meRoute(store: Store, context: Context, token: Verified, owner: boolean, now: number, signal: AbortSignal): Promise<Response> {
  // Solo se guarda un email verificado; nunca se registra en logs.
  const email = token.emailVerified === true && token.email ? token.email.toLowerCase() : null;
  await guarded(signal, () => store.touchUser(token.uid, email, now));
  // Secuencial: tras una cancelación no empieza ninguna lectura más.
  const subscription = await guarded(signal, () => store.getSubscription(token.uid));
  const settings = await guarded(signal, () => store.getSettings());
  return respond(context, 200, {
    uid: token.uid,
    role: owner ? "owner" : "user",
    subscription: subscriptionView(subscription, now),
    payments: publicPayments(settings.payments),
  });
}

async function adminRoute(
  request: Request,
  env: Env,
  store: Store,
  context: Context,
  rest: string,
  token: Verified,
  now: number,
  signal: AbortSignal,
): Promise<Response> {
  const method = request.method;
  const notAllowed = (allow: string) => fail(context, 405, "INVALID_REQUEST", { extra: { Allow: `${allow}, OPTIONS` } });

  if (rest === "/users") {
    if (method !== "GET") return notAllowed("GET");
    const query = new URL(request.url).searchParams;
    const cursor = query.get("cursor");
    const limitText = query.get("limit");
    const limit = limitText === null ? ADMIN_CAPS.defaultUsersPage : Number(limitText);
    if ((cursor !== null && !isUid(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > ADMIN_CAPS.maxUsersPage) {
      return fail(context, 400, "INVALID_REQUEST");
    }
    const page = await guarded(signal, () => store.listUsers(cursor, limit));
    return respond(context, 200, {
      users: page.users.map((user) => ({
        uid: user.uid,
        email: user.email,
        createdAt: user.createdAt,
        subscription: subscriptionView(user.subscription, now),
      })),
      nextCursor: page.nextCursor,
    });
  }

  const subscriptionMatch = SUBSCRIPTION_PATH.exec(rest);
  if (subscriptionMatch) {
    if (method !== "PUT") return notAllowed("PUT");
    const uid = subscriptionMatch[1];
    if (!isUid(uid)) return fail(context, 400, "INVALID_REQUEST");
    const body = await readJson(request, signal);
    if (!body.ok) return fail(context, body.status, body.code);
    const update = parseSubscriptionUpdate(body.value, now);
    if (!update.ok) return fail(context, 400, "INVALID_REQUEST");
    const saved = await guarded(signal, () => store.setSubscription(uid, update.value, now, token.uid));
    if (!saved) return fail(context, 404, "INVALID_REQUEST");
    return respond(context, 200, { uid, subscription: subscriptionView(saved, now) });
  }

  if (rest === "/settings") {
    if (method === "GET") return respond(context, 200, await guarded(signal, () => store.getSettings()));
    if (method !== "PUT") return notAllowed("GET, PUT");
    // Catálogo de hasta 20 países con sus instrucciones: tope propio de 128 KiB.
    const body = await readJson(request, signal, SETTINGS_BODY_BYTES);
    if (!body.ok) return fail(context, body.status, body.code);
    const update = parseSettingsUpdate(body.value);
    if (!update.ok) return fail(context, 400, "INVALID_REQUEST");
    return respond(context, 200, await guarded(signal, () => store.updateSettings(update.value, now, token.uid)));
  }

  if (rest === "/status") {
    if (method !== "GET") return notAllowed("GET");
    // Solo configuración y registros guardados: mirar el estado NUNCA dispara una petición a un proveedor.
    const settings = await guarded(signal, () => store.getSettings());
    const records = await guarded(signal, () => store.providerRecords());
    const sarinConfigured = sarinAuthFrom(env).mode !== "unconfigured";
    const deepseekConfigured = deepseekConfigFrom(env) !== undefined;
    const status = (configured: boolean, record: ProviderRecord) => ({
      configured,
      state: providerState(configured, record),
      lastSuccessAt: record.lastSuccessAt,
      lastFailureAt: record.lastFailureAt,
    });
    return respond(context, 200, {
      activeProvider: settings.translation.activeProvider,
      providers: { sarin: status(sarinConfigured, records.sarin), deepseek: status(deepseekConfigured, records.deepseek) },
    });
  }

  // Cualquier otra ruta: no existe. Se llega aquí solo siendo propietario.
  return fail(context, 404, "INVALID_REQUEST");
}

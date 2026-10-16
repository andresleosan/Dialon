import { DEFAULT_PAYMENT_SETTINGS, DEFAULT_TRANSLATION_SETTINGS, parseApiError, parseTextTranslationResult } from "@dialon/contracts";
import { describe, expect, it, vi } from "vitest";
import type { TokenOutcome } from "./firebaseToken";
import type { Store, StoredSubscription } from "./store";
import { handleRequest } from "./translate";

// Verificador, limitador y Sarin inyectados: pruebas del orden, los límites y los errores del handler, sin red.

const ORIGINS = "https://dialon.pages.dev,http://localhost:8081";
const ID = "6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f809a1b";
const TOKEN = "Bearer aaa.bbb.ccc";
const SECRET_KEY = "clave-sarin-de-prueba";
const TEXT = "Texto privado de Ana";
const UPSTREAM_SECRET_BODY = "detalle-interno-del-upstream";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function completion(content: string) {
  return JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
}

type Limit = (options: { key: string }) => Promise<{ success: boolean }>;
type Verify = (authorization: string | null, signal: AbortSignal) => Promise<TokenOutcome>;

interface Setup {
  readonly token?: TokenOutcome;
  readonly limit?: boolean;
  readonly env?: Record<string, unknown>;
  readonly upstream?: ReturnType<typeof vi.fn<Fetch>>;
  /** `null` = sin binding (con `undefined` se aplicaría el valor por defecto). */
  readonly limiter?: { limit: Limit } | null;
  readonly store?: Store;
}

const ACTIVE: StoredSubscription = {
  status: "active",
  plan: "monthly",
  periodStart: 0,
  expiresAt: Date.now() + 30 * 86_400_000,
  maxRequests: 100,
  maxChars: 100_000,
  usedRequests: 0,
  usedChars: 0,
};

/** Almacén sustituto: suscripción activa, Sarin activo y cuota disponible salvo que se cambie. */
function fakeStore(overrides: Partial<Store> = {}): Store {
  return {
    touchUser: vi.fn<Store["touchUser"]>(() => Promise.resolve()),
    getSubscription: vi.fn<Store["getSubscription"]>(() => Promise.resolve(ACTIVE)),
    listUsers: vi.fn<Store["listUsers"]>(() => Promise.resolve({ users: [], nextCursor: null })),
    setSubscription: vi.fn<Store["setSubscription"]>(() => Promise.resolve(ACTIVE)),
    getSettings: vi.fn<Store["getSettings"]>(() =>
      Promise.resolve({ translation: DEFAULT_TRANSLATION_SETTINGS, payments: DEFAULT_PAYMENT_SETTINGS }),
    ),
    updateSettings: vi.fn<Store["updateSettings"]>(() =>
      Promise.resolve({ translation: DEFAULT_TRANSLATION_SETTINGS, payments: DEFAULT_PAYMENT_SETTINGS }),
    ),
    reserveQuota: vi.fn<Store["reserveQuota"]>(() => Promise.resolve("ok")),
    recordProvider: vi.fn<Store["recordProvider"]>(() => Promise.resolve()),
    providerRecords: vi.fn<Store["providerRecords"]>(() =>
      Promise.resolve({
        sarin: { lastSuccessAt: null, lastFailureAt: null },
        deepseek: { lastSuccessAt: null, lastFailureAt: null },
      }),
    ),
    ...overrides,
  };
}

function okUpstream() {
  return vi.fn<Fetch>(() =>
    Promise.resolve(new Response(completion("Texto traduzido"), { headers: { "Content-Type": "application/json" } })),
  );
}

function setup(options: Setup = {}) {
  const token: TokenOutcome = options.token ?? { ok: true, uid: "uid-ana" };
  const extra = options.env ?? { SARIN_AUTH_MODE: "bearer", SARIN_API_KEY: SECRET_KEY };
  const upstream = options.upstream ?? okUpstream();
  const limiter =
    options.limiter === undefined ? { limit: vi.fn<Limit>(() => Promise.resolve({ success: options.limit ?? true })) } : options.limiter;
  const verify = vi.fn<Verify>(() => Promise.resolve(token));
  const logs: string[] = [];
  const store = options.store ?? fakeStore();
  const env = { ALLOWED_ORIGINS: ORIGINS, ...(limiter ? { TRANSLATE_LIMITER: limiter } : {}), ...extra } as unknown as Env;
  const deps = { verifier: { verify }, fetch: upstream, store, log: (line: string) => logs.push(line) };
  return { verify, upstream, limiter, logs, store, run: (request: Request) => handleRequest(request, env, deps) };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://api.example/v1/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN, Origin: "https://dialon.pages.dev", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = { requestId: ID, source: "es", target: "pt", text: TEXT };

async function errorOf(response: Response) {
  const parsed = parseApiError(await response.json());
  if (!parsed.ok) throw new Error("error con forma inesperada");
  return parsed.value;
}

describe("handleRequest: ruta, método y origen", () => {
  it("404 fuera de /v1/translate y 405 con otro método", async () => {
    const { run } = setup();
    const missing = await run(new Request("https://api.example/v1/otra", { method: "POST" }));
    expect(missing.status).toBe(404);
    const wrong = await run(new Request("https://api.example/v1/translate", { method: "GET" }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  it("el preflight solo se concede a orígenes permitidos; un POST de otro origen se rechaza sin verificar el token", async () => {
    const { run, verify } = setup();
    const ok = await run(
      new Request("https://api.example/v1/translate", { method: "OPTIONS", headers: { Origin: "http://localhost:8081" } }),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8081");
    expect(ok.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    expect(ok.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    const foreign = await run(
      new Request("https://api.example/v1/translate", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
    );
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const response = await run(post(VALID, { Origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("FORBIDDEN");
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("handleRequest: falla cerrado antes de llamar a Sarin", () => {
  it("con Sarin sin configurar responde 503 sin verificar ni llamar a nadie", async () => {
    const { run, upstream, verify } = setup({ env: {} });
    const response = await run(post(VALID));
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("SERVICE_UNAVAILABLE");
    expect(verify).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sin token válido responde 401 y no consume límite ni llama a Sarin; caducado da TOKEN_EXPIRED", async () => {
    for (const [token, code] of [
      [{ ok: false, code: "UNAUTHENTICATED" }, "UNAUTHENTICATED"],
      [{ ok: false, code: "TOKEN_EXPIRED" }, "TOKEN_EXPIRED"],
    ] as const) {
      const { run, upstream, limiter } = setup({ token });
      const response = await run(post(VALID));
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe(code);
      expect(limiter?.limit).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it("aplica el límite con la clave de la ruta y el uid verificado; agotado da 429 con Retry-After", async () => {
    const { run, upstream, limiter } = setup({ limit: false });
    const response = await run(post(VALID));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await errorOf(response)).code).toBe("RATE_LIMITED");
    expect(limiter?.limit).toHaveBeenCalledWith({ key: "translate:uid-ana" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sin binding de límite, o si el limitador falla, responde 503", async () => {
    const missing = setup({ limiter: null });
    expect((await missing.run(post(VALID))).status).toBe(503);
    const broken = setup({ limiter: { limit: vi.fn<Limit>(() => Promise.reject(new Error("caído"))) } });
    expect((await broken.run(post(VALID))).status).toBe(503);
    expect(missing.upstream).not.toHaveBeenCalled();
    expect(broken.upstream).not.toHaveBeenCalled();
  });
});

describe("handleRequest: cuerpo y contrato", () => {
  it("rechaza cuerpos de más de 16 KiB (también sin Content-Length), Content-Type incorrecto y JSON inválido", async () => {
    const { run, upstream } = setup();
    const big = new TextEncoder().encode("x".repeat(16 * 1024 + 1));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const streamed = new Request("https://api.example/v1/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: TOKEN },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await run(streamed)).status).toBe(413);
    expect((await run(post("{}", { "Content-Length": "20000" }))).status).toBe(413);
    expect((await run(post(VALID, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await run(post("{roto"))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rechaza campos ajenos e idiomas fuera del catálogo; pt vale por defecto y TRANSLATION_LANGUAGES amplía el catálogo", async () => {
    const { run } = setup();
    const extra = await run(post({ ...VALID, uid: "otro", model: "otro" }));
    expect(extra.status).toBe(400);
    expect((await errorOf(extra)).code).toBe("INVALID_REQUEST");
    const japanese = await run(post({ ...VALID, target: "ja" }));
    expect(japanese.status).toBe(400);
    expect((await errorOf(japanese)).code).toBe("UNSUPPORTED_LANGUAGE");
    expect((await run(post(VALID))).status).toBe(200);

    const configured = setup({ env: { SARIN_AUTH_MODE: "none", TRANSLATION_LANGUAGES: "es,ja,fr" } });
    expect((await configured.run(post({ ...VALID, target: "ja" }))).status).toBe(200);
    expect((await configured.run(post({ ...VALID, target: "fr" }))).status).toBe(200);
    expect((await configured.run(post(VALID))).status).toBe(400);
    const invalid = setup({ env: { SARIN_AUTH_MODE: "none", TRANSLATION_LANGUAGES: "es" } });
    expect((await invalid.run(post(VALID))).status).toBe(500);
  });
});

describe("handleRequest: resultado y errores del upstream", () => {
  it("devuelve un TextTranslationResult válido con el mismo requestId, tiempos y cabeceras seguras", async () => {
    const { run, upstream } = setup();
    const response = await run(post(VALID));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://dialon.pages.dev");
    const result = parseTextTranslationResult(await response.json());
    expect(result).toMatchObject({ ok: true, value: { requestId: ID, translation: "Texto traduzido", mode: "real" } });
    if (result.ok) expect(Object.keys(result.value.timingsMs ?? {}).sort()).toEqual(["auth", "total", "translate"]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("traduce los fallos de Sarin a 502/503/504 con el requestId y sin filtrar el cuerpo del upstream", async () => {
    const cases: [Response, number, string][] = [
      [new Response(UPSTREAM_SECRET_BODY, { status: 500 }), 502, "SERVICE_UNAVAILABLE"],
      [new Response(UPSTREAM_SECRET_BODY, { status: 429 }), 503, "BUSY"],
      [new Response(UPSTREAM_SECRET_BODY, { status: 504 }), 504, "TIMEOUT"],
    ];
    for (const [upstreamResponse, status, code] of cases) {
      const { run, upstream } = setup({ upstream: vi.fn<Fetch>(() => Promise.resolve(upstreamResponse)) });
      const response = await run(post(VALID));
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).not.toContain(UPSTREAM_SECRET_BODY);
      expect(parseApiError(JSON.parse(text))).toMatchObject({ ok: true, value: { code, requestId: ID } });
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });

  it("si el cliente se va mientras se verifica el token, responde TIMEOUT sin llamar a Sarin", async () => {
    const controller = new AbortController();
    const { run, upstream, verify } = setup();
    verify.mockImplementationOnce(
      (_authorization, signal) =>
        new Promise<TokenOutcome>((resolve) => {
          signal.addEventListener("abort", () => {
            resolve({ ok: false, code: "TIMEOUT" });
          });
        }),
    );
    const request = new Request(post(VALID), { signal: controller.signal });
    const pending = run(request);
    controller.abort();
    expect((await pending).status).toBe(504);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("ni las respuestas ni los logs contienen el texto, el token, la clave, el uid ni el cuerpo del upstream (también con DeepSeek)", async () => {
    const deepseekStore = fakeStore({
      getSettings: vi.fn<Store["getSettings"]>(() =>
        Promise.resolve({ translation: { activeProvider: "deepseek", externalProvidersEnabled: true }, payments: DEFAULT_PAYMENT_SETTINGS }),
      ),
    });
    const external = setup({
      env: { DEEPSEEK_API_KEY: "clave-deepseek-de-prueba", DEEPSEEK_MODEL: "deepseek-flash" },
      store: deepseekStore,
      upstream: vi.fn<Fetch>(() => Promise.resolve(new Response(UPSTREAM_SECRET_BODY, { status: 500 }))),
    });
    const externalResponse = await external.run(post({ ...VALID, externalProcessingConsent: true }));
    const externalAll = [...external.logs, await externalResponse.text(), JSON.stringify([...externalResponse.headers])].join("\n");
    for (const secret of [TEXT, "aaa.bbb.ccc", "clave-deepseek-de-prueba", "uid-ana", UPSTREAM_SECRET_BODY]) {
      expect(externalAll).not.toContain(secret);
    }
  });

  it("ni las respuestas ni los logs contienen el texto, el token, la clave, el uid ni el cuerpo del upstream", async () => {
    const seen: string[] = [];
    for (const upstream of [okUpstream(), vi.fn<Fetch>(() => Promise.resolve(new Response(UPSTREAM_SECRET_BODY, { status: 500 })))]) {
      const { run, logs } = setup({ upstream });
      const response = await run(post(VALID));
      seen.push(...logs, JSON.stringify([...response.headers]));
      const body = await response.text();
      if (response.status !== 200) seen.push(body);
      expect(logs.length).toBeGreaterThan(0);
    }
    const all = seen.join("\n");
    for (const secret of [TEXT, TOKEN, "aaa.bbb.ccc", SECRET_KEY, "uid-ana", UPSTREAM_SECRET_BODY]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("handleRequest: suscripción, cuota y proveedor del propietario", () => {
  const DEEPSEEK_ENV = { SARIN_AUTH_MODE: "none", DEEPSEEK_API_KEY: "clave-deepseek-de-prueba", DEEPSEEK_MODEL: "deepseek-flash" };
  const deepseekSettings = () =>
    vi.fn<Store["getSettings"]>(() =>
      Promise.resolve({ translation: { activeProvider: "deepseek", externalProvidersEnabled: true }, payments: DEFAULT_PAYMENT_SETTINGS }),
    );

  it("sin suscripción, suspendida o vencida: 403 SUBSCRIPTION_REQUIRED sin reservar ni llamar", async () => {
    for (const subscription of [
      null,
      { ...ACTIVE, status: "suspended" as const },
      { ...ACTIVE, status: "inactive" as const },
      { ...ACTIVE, expiresAt: Date.now() - 1000 },
    ]) {
      const store = fakeStore({ getSubscription: vi.fn<Store["getSubscription"]>(() => Promise.resolve(subscription)) });
      const { run, upstream } = setup({ store });
      const response = await run(post(VALID));
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("SUBSCRIPTION_REQUIRED");
      expect(store.reserveQuota).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it("reserva con el uid del token y la longitud del texto; sin cuota 429 QUOTA_EXCEEDED sin llamar", async () => {
    const ok = setup();
    expect((await ok.run(post(VALID))).status).toBe(200);
    expect(ok.store.reserveQuota).toHaveBeenCalledWith("uid-ana", TEXT.length, expect.any(Number));

    const store = fakeStore({ reserveQuota: vi.fn<Store["reserveQuota"]>(() => Promise.resolve("quota")) });
    const exhausted = setup({ store });
    const response = await exhausted.run(post(VALID));
    expect(response.status).toBe(429);
    expect((await errorOf(response)).code).toBe("QUOTA_EXCEEDED");
    expect(exhausted.upstream).not.toHaveBeenCalled();
  });

  it("si D1 falla o falta, responde 503 sin llamar al proveedor", async () => {
    const broken = setup({ store: fakeStore({ getSubscription: vi.fn<Store["getSubscription"]>(() => Promise.reject(new Error("d1"))) }) });
    expect((await broken.run(post(VALID))).status).toBe(503);
    expect(broken.upstream).not.toHaveBeenCalled();
  });

  it("con DeepSeek activo: sin consentimiento 403 CONSENT_REQUIRED; con consentimiento llama solo a DeepSeek; sin fallback si falla", async () => {
    const store = fakeStore({ getSettings: deepseekSettings() });
    const noConsent = setup({ env: DEEPSEEK_ENV, store });
    const refused = await noConsent.run(post(VALID));
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("CONSENT_REQUIRED");
    expect(noConsent.upstream).not.toHaveBeenCalled();
    expect(store.reserveQuota).not.toHaveBeenCalled();

    const okUpstreamFn = okUpstream();
    const consented = setup({ env: DEEPSEEK_ENV, store: fakeStore({ getSettings: deepseekSettings() }), upstream: okUpstreamFn });
    expect((await consented.run(post({ ...VALID, externalProcessingConsent: true }))).status).toBe(200);
    expect(okUpstreamFn.mock.calls.map(([url]) => url)).toEqual(["https://api.deepseek.com/chat/completions"]);

    const failing = vi.fn<Fetch>(() => Promise.resolve(new Response("x", { status: 500 })));
    const noFallback = setup({ env: DEEPSEEK_ENV, store: fakeStore({ getSettings: deepseekSettings() }), upstream: failing });
    expect((await noFallback.run(post({ ...VALID, externalProcessingConsent: true }))).status).toBe(502);
    expect(failing.mock.calls.map(([url]) => url)).toEqual(["https://api.deepseek.com/chat/completions"]);
  });

  it("DeepSeek activo pero sin configurar, o con los externos deshabilitados en ajustes: 503 sin llamar", async () => {
    const unconfigured = setup({ env: { SARIN_AUTH_MODE: "none" }, store: fakeStore({ getSettings: deepseekSettings() }) });
    expect((await unconfigured.run(post({ ...VALID, externalProcessingConsent: true }))).status).toBe(503);
    expect(unconfigured.upstream).not.toHaveBeenCalled();

    const disabled = setup({
      env: DEEPSEEK_ENV,
      store: fakeStore({
        getSettings: vi.fn<Store["getSettings"]>(() =>
          Promise.resolve({ translation: { activeProvider: "deepseek", externalProvidersEnabled: false }, payments: DEFAULT_PAYMENT_SETTINGS }),
        ),
      }),
    });
    expect((await disabled.run(post({ ...VALID, externalProcessingConsent: true }))).status).toBe(503);
    expect(disabled.upstream).not.toHaveBeenCalled();
  });

  it("con Sarin activo el consentimiento se acepta y no cambia de proveedor; con Sarin sin configurar y DeepSeek configurado, 503", async () => {
    const sarin = setup({ env: DEEPSEEK_ENV });
    expect((await sarin.run(post({ ...VALID, externalProcessingConsent: true }))).status).toBe(200);
    expect(sarin.upstream.mock.calls.map(([url]) => url)).toEqual(["https://ia-sarin.alsdevstudio.com/v1/chat/completions"]);

    const onlyDeepseek = setup({ env: { DEEPSEEK_API_KEY: "clave-deepseek-de-prueba", DEEPSEEK_MODEL: "deepseek-flash" } });
    expect((await onlyDeepseek.run(post(VALID))).status).toBe(503);
    expect(onlyDeepseek.upstream).not.toHaveBeenCalled();
  });

  it("registra éxito o fallo del proveedor activo, y un fallo al registrar no cambia la respuesta", async () => {
    const store = fakeStore({ recordProvider: vi.fn<Store["recordProvider"]>(() => Promise.reject(new Error("d1"))) });
    const { run } = setup({ store });
    expect((await run(post(VALID))).status).toBe(200);
    expect(store.recordProvider).toHaveBeenCalledWith("sarin", true, expect.any(Number));
  });

  it("si D1 se queda colgado leyendo la suscripción y el cliente cancela: 504 sin pasos posteriores ni llamada", async () => {
    const store = fakeStore({ getSubscription: vi.fn<Store["getSubscription"]>(() => new Promise(() => undefined)) });
    const { run, upstream } = setup({ store });
    const controller = new AbortController();
    const pending = run(new Request(post(VALID), { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect((await pending).status).toBe(504);
    expect(store.getSettings).not.toHaveBeenCalled();
    expect(store.reserveQuota).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("un registro del proveedor colgado no retrasa la respuesta más de su presupuesto (250 ms)", async () => {
    const store = fakeStore({ recordProvider: vi.fn<Store["recordProvider"]>(() => new Promise(() => undefined)) });
    const { run } = setup({ store });
    const started = Date.now();
    const response = await run(post(VALID));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "sarin", processing: "owner_hosted" });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

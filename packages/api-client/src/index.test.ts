import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./index";

// Servidor y token simulados: el cliente se prueba aislado, sin red.

const ID = "6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f809a1b";
const REQUEST = { requestId: ID, source: "es", target: "pt", text: "Hola, ¿qué tal?" };
const BASE = "https://api.example";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const OK_BODY = { requestId: ID, translation: "Olá, tudo bem?", mode: "real", timingsMs: { total: 900 } };

function client({
  token = vi.fn<(signal: AbortSignal) => Promise<string | null>>(() => Promise.resolve("token-de-prueba")),
  fetchFn = vi.fn<Fetch>(() => Promise.resolve(json(OK_BODY))),
  timeoutMs,
}: { token?: (signal: AbortSignal) => Promise<string | null>; fetchFn?: Fetch; timeoutMs?: number } = {}) {
  return { token, fetchFn, api: createApiClient({ baseUrl: BASE, getIdToken: token, fetch: fetchFn, timeoutMs }) };
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe("createApiClient: URL base", () => {
  it("solo admite https o http de loopback para desarrollo", () => {
    const options = { getIdToken: () => Promise.resolve(null) };
    for (const baseUrl of ["https://api.example", "http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) {
      expect(() => createApiClient({ ...options, baseUrl })).not.toThrow();
    }
    for (const baseUrl of ["http://api.example", "ftp://api.example", "no-es-url", "https://user:pw@api.example"]) {
      expect(() => createApiClient({ ...options, baseUrl })).toThrow(TypeError);
    }
  });
});

describe("translateText: antes de enviar", () => {
  it("una petición inválida (campo ajeno, idioma fuera del catálogo) no pide token ni llama", async () => {
    const { api, token, fetchFn } = client();
    await expect(api.translateText({ ...REQUEST, uid: "otro" } as typeof REQUEST)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
    await expect(api.translateText({ ...REQUEST, target: "ja" })).resolves.toMatchObject({ ok: false, code: "UNSUPPORTED_LANGUAGE" });
    expect(token).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sin token, o si obtenerlo falla, da UNAUTHENTICATED sin llamar", async () => {
    for (const token of [vi.fn(() => Promise.resolve(null)), vi.fn(() => Promise.reject(new Error("sdk")))]) {
      const { api, fetchFn } = client({ token });
      await expect(api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });
});

describe("translateText: respuesta", () => {
  it("envía una sola petición POST con el token y el cuerpo validado, sin seguir redirecciones, y valida el resultado", async () => {
    const { api, fetchFn } = client();
    await expect(api.translateText(REQUEST)).resolves.toEqual({
      ok: true,
      value: { requestId: ID, translation: "Olá, tudo bem?", mode: "real", timingsMs: { total: 900 } },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("https://api.example/v1/translate");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-de-prueba");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST);
  });

  it("requestId distinto, cuerpo inválido, HTML o respuesta de más de 16 KiB dan INVALID_RESPONSE", async () => {
    const bodies = [
      json({ ...OK_BODY, requestId: "00000000-0000-4000-8000-000000000001" }),
      json({ ...OK_BODY, mode: "demo" }),
      new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      json({ ...OK_BODY, translation: "a".repeat(17 * 1024) }),
    ];
    for (const response of bodies) {
      const { api } = client({ fetchFn: vi.fn<Fetch>(() => Promise.resolve(response)) });
      await expect(api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    }
  });

  it("un error del servidor se devuelve por código conocido con mensaje fijo, sin repetir el mensaje remoto", async () => {
    const remote = json({ error: { code: "RATE_LIMITED", message: "<script>mensaje remoto</script>" }, requestId: ID }, 429);
    const { api } = client({ fetchFn: vi.fn<Fetch>(() => Promise.resolve(remote)) });
    const result = await api.translateText(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(JSON.stringify(result)).not.toContain("mensaje remoto");

    const unknown = json({ error: { code: "INVENTADO", message: "x" } }, 500);
    const other = client({ fetchFn: vi.fn<Fetch>(() => Promise.resolve(unknown)) });
    await expect(other.api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });

  it("un fallo de red da NETWORK, sin reintentos y sin escribir en la consola", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const fetchFn = vi.fn<Fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
    const { api } = client({ fetchFn });
    await expect(api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "NETWORK" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});

describe("translateText: cancelación y plazo", () => {
  async function expectAbortError(promise: Promise<unknown>) {
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  }

  it("cancelar antes de empezar, mientras se pide el token, durante el fetch o mientras se lee la respuesta rechaza con AbortError", async () => {
    const before = new AbortController();
    before.abort();
    const first = client();
    await expectAbortError(first.api.translateText(REQUEST, before.signal));
    expect(first.token).not.toHaveBeenCalled();

    const duringToken = new AbortController();
    const second = client({ token: vi.fn(() => never<string>()) });
    const pendingToken = second.api.translateText(REQUEST, duringToken.signal);
    duringToken.abort();
    await expectAbortError(pendingToken);
    expect(second.fetchFn).not.toHaveBeenCalled();

    const duringFetch = new AbortController();
    const third = client({
      fetchFn: vi.fn<Fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("abortado", "AbortError"));
            });
          }),
      ),
    });
    const pendingFetch = third.api.translateText(REQUEST, duringFetch.signal);
    await vi.waitFor(() => {
      expect(third.fetchFn).toHaveBeenCalled();
    });
    duringFetch.abort();
    await expectAbortError(pendingFetch);

    const duringBody = new AbortController();
    const stalled = new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const fourth = client({ fetchFn: vi.fn<Fetch>(() => Promise.resolve(stalled)) });
    const pendingBody = fourth.api.translateText(REQUEST, duringBody.signal);
    await vi.waitFor(() => {
      expect(fourth.fetchFn).toHaveBeenCalled();
    });
    duringBody.abort();
    await expectAbortError(pendingBody);
  });

  it("su propio plazo (token, fetch o lectura colgados) da TIMEOUT, no AbortError", async () => {
    const hangingToken = client({ token: vi.fn(() => never<string>()), timeoutMs: 30 });
    await expect(hangingToken.api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "TIMEOUT" });
    const hangingFetch = client({
      fetchFn: vi.fn<Fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("plazo", "TimeoutError"));
            });
          }),
      ),
      timeoutMs: 30,
    });
    await expect(hangingFetch.api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "TIMEOUT" });
  });
});

describe("translateText: respuestas sin stream legible", () => {
  // Adaptadores de fetch que no dan un `Response.body` legible (sin body, sin getReader o con getReader que falla): el
  // cliente no puede imponer el tope de 16 KiB sin descargarlo todo, así que rechaza sin leer nada.
  function nonStreaming(body: unknown, status = 200) {
    const huge = "x".repeat(10 * 1024 * 1024);
    const text = vi.fn(() => Promise.resolve(huge));
    const json = vi.fn(() => Promise.resolve({ huge }));
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(10 * 1024 * 1024)));
    const response = {
      status,
      ok: status === 200,
      headers: new Headers({ "Content-Type": "application/json", "Content-Length": "10" }),
      body,
      bodyUsed: false,
      text,
      json,
      arrayBuffer,
    } as unknown as Response;
    return { response, readers: [text, json, arrayBuffer] };
  }

  it("da INVALID_RESPONSE sin llamar a text(), json() ni arrayBuffer(), aunque Content-Length diga que es pequeño", async () => {
    const throwingReader = {
      getReader: () => {
        throw new TypeError("stream bloqueado");
      },
    };
    for (const [body, status] of [
      [null, 200],
      [{}, 200],
      [throwingReader, 200],
      [null, 429],
    ] as const) {
      const { response, readers } = nonStreaming(body, status);
      const { api } = client({ fetchFn: vi.fn<Fetch>(() => Promise.resolve(response)) });
      await expect(api.translateText(REQUEST)).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
      for (const read of readers) expect(read).not.toHaveBeenCalled();
    }
  });
});

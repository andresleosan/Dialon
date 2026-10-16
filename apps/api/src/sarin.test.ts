import { describe, expect, it, vi } from "vitest";
import { SARIN_ENDPOINT, SARIN_MODEL, sarinAuthFrom, translateWithSarin, type SarinAuth } from "./sarin";

// Sarin SIMULADO: estas pruebas no demuestran que el servicio real exista, responda así ni traduzca bien.

const INPUT = { text: "Hola, ¿qué tal?", source: "es", target: "pt", maxChars: 2000 };
const NONE: SarinAuth = { mode: "none" };

function completion(content: unknown, extra: Record<string, unknown> = {}, finishReason = "stop") {
  return JSON.stringify({ choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content, ...extra } }] });
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function upstream(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn<Fetch>(() =>
    Promise.resolve(
      new Response(body, { status: init.status ?? 200, headers: init.headers ?? { "Content-Type": "application/json" } }),
    ),
  );
}

const signal = () => new AbortController().signal;

describe("configuración de autenticación de Sarin", () => {
  it("sin SARIN_AUTH_MODE, con un valor desconocido o bearer sin clave queda sin configurar; solo none y bearer explícitos valen", () => {
    expect(sarinAuthFrom({})).toEqual({ mode: "unconfigured" });
    expect(sarinAuthFrom({ SARIN_AUTH_MODE: "abierto" })).toEqual({ mode: "unconfigured" });
    expect(sarinAuthFrom({ SARIN_AUTH_MODE: "bearer" })).toEqual({ mode: "unconfigured" });
    expect(sarinAuthFrom({ SARIN_AUTH_MODE: "bearer", SARIN_API_KEY: "  " })).toEqual({ mode: "unconfigured" });
    expect(sarinAuthFrom({ SARIN_AUTH_MODE: "none" })).toEqual({ mode: "none" });
    expect(sarinAuthFrom({ SARIN_AUTH_MODE: "bearer", SARIN_API_KEY: "clave-de-prueba" })).toEqual({
      mode: "bearer",
      key: "clave-de-prueba",
    });
  });
});

describe("translateWithSarin", () => {
  it("sin configurar no hace ninguna petición", async () => {
    const fetchFn = upstream(completion("Olá"));
    await expect(translateWithSarin(INPUT, { mode: "unconfigured" }, fetchFn, signal())).resolves.toMatchObject({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("envía exactamente la URL, el modelo, stream:false y el texto fijos, sin seguir redirecciones; none sin cabecera", async () => {
    const fetchFn = upstream(completion(" Olá, tudo bem? "));
    await expect(translateWithSarin(INPUT, NONE, fetchFn, signal())).resolves.toEqual({ ok: true, translation: "Olá, tudo bem?", upstreamStatus: 200 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://ia-sarin.alsdevstudio.com/v1/chat/completions");
    expect(SARIN_ENDPOINT).toBe(url);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBeNull();
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "qwen3.8:27b-q4_K_M", stream: false, temperature: 0, max_tokens: 1024 });
    expect(SARIN_MODEL).toBe(body.model);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[0]?.content).toContain("es");
    expect(messages[0]?.content).toContain("pt");
    expect(messages[1]?.content).toBe("Hola, ¿qué tal?");
  });

  it("bearer añade la clave solo en la cabecera Authorization", async () => {
    const fetchFn = upstream(completion("Olá"));
    await translateWithSarin(INPUT, { mode: "bearer", key: "clave-de-prueba" }, fetchFn, signal());
    const init = fetchFn.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer clave-de-prueba");
    expect(init?.body as string).not.toContain("clave-de-prueba");
  });

  it("ignora reasoning/reasoning_content separados, pero rechaza razonamiento dentro de content y finish_reason length", async () => {
    await expect(
      translateWithSarin(INPUT, NONE, upstream(completion("Olá", { reasoning_content: "pienso…", reasoning: "x" })), signal()),
    ).resolves.toMatchObject({ ok: true, translation: "Olá" });
    for (const body of [completion("<think>pienso</think>Olá"), completion("Olá</think>"), completion("Olá", {}, "length")]) {
      await expect(translateWithSarin(INPUT, NONE, upstream(body), signal())).resolves.toMatchObject({
        ok: false,
        code: "SERVICE_UNAVAILABLE",
      });
    }
  });

  it("rechaza salida vacía, demasiado larga, JSON inválido, HTML, forma inesperada y cuerpos de más de 64 KiB", async () => {
    const bodies = [
      upstream(completion("   ")),
      upstream(completion("a".repeat(2001))),
      upstream(completion(42)),
      upstream("{no-json"),
      upstream("<html>error</html>", { headers: { "Content-Type": "text/html" } }),
      upstream(JSON.stringify({ choices: [] })),
      upstream(JSON.stringify({ result: "Olá" })),
      upstream(completion("a".repeat(70 * 1024))),
    ];
    for (const fetchFn of bodies) {
      await expect(translateWithSarin(INPUT, NONE, fetchFn, signal())).resolves.toMatchObject({
        ok: false,
        code: "SERVICE_UNAVAILABLE",
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("traduce los estados del upstream a errores seguros y nunca reintenta", async () => {
    const cases: [number, string][] = [
      [302, "SERVICE_UNAVAILABLE"],
      [401, "SERVICE_UNAVAILABLE"],
      [403, "SERVICE_UNAVAILABLE"],
      [429, "BUSY"],
      [500, "SERVICE_UNAVAILABLE"],
      [503, "SERVICE_UNAVAILABLE"],
      [504, "TIMEOUT"],
    ];
    for (const [status, code] of cases) {
      const fetchFn = upstream(completion("Olá"), { status });
      await expect(translateWithSarin(INPUT, NONE, fetchFn, signal())).resolves.toEqual({ ok: false, code, upstreamStatus: status });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("un fallo de red da SERVICE_UNAVAILABLE y el plazo agotado o la cancelación abortan la petición con TIMEOUT", async () => {
    const offline = vi.fn<Fetch>(() => Promise.reject(new TypeError("fetch failed")));
    await expect(translateWithSarin(INPUT, NONE, offline, signal())).resolves.toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });

    let aborted = false;
    const hanging = vi.fn<Fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("abortado", "AbortError"));
          });
        }),
    );
    await expect(translateWithSarin(INPUT, NONE, hanging, AbortSignal.timeout(20))).resolves.toMatchObject({
      ok: false,
      code: "TIMEOUT",
    });
    expect(aborted).toBe(true);
  });

  it("un cuerpo que se queda colgado tras las cabeceras también respeta el plazo", async () => {
    const stalled = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(translateWithSarin(INPUT, NONE, stalled, AbortSignal.timeout(20))).resolves.toMatchObject({
      ok: false,
      code: "TIMEOUT",
    });
  });
});

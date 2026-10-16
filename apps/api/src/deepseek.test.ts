import { describe, expect, it, vi } from "vitest";
import { DEEPSEEK_ENDPOINT, deepseekConfigFrom, translateWithDeepSeek } from "./deepseek";

// DeepSeek SIMULADO: no demuestra que el servicio real responda así. Clave sintética.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const INPUT = { text: "Hola", source: "es", target: "en", maxChars: 2000 };
const KEY = "clave-deepseek-sintetica";
const CONFIG = { key: KEY, model: "deepseek-flash" } as const;

function reply(body: string, init: { status?: number; type?: string } = {}) {
  return vi.fn<Fetch>(() =>
    Promise.resolve(new Response(body, { status: init.status ?? 200, headers: { "Content-Type": init.type ?? "application/json" } })),
  );
}

function completion(content: unknown, finishReason = "stop", extra: Record<string, unknown> = {}) {
  return JSON.stringify({ choices: [{ finish_reason: finishReason, message: { role: "assistant", content, ...extra } }] });
}

describe("configuración de DeepSeek", () => {
  it("solo con clave y un modelo de la lista; cualquier otro modelo deja DeepSeek sin configurar", () => {
    expect(deepseekConfigFrom({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_MODEL: "deepseek-flash" })).toEqual(CONFIG);
    expect(deepseekConfigFrom({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_MODEL: "deepseek-v4-pro" })).toEqual({ key: KEY, model: "deepseek-v4-pro" });
    for (const env of [
      {},
      { DEEPSEEK_API_KEY: KEY },
      { DEEPSEEK_MODEL: "deepseek-flash" },
      { DEEPSEEK_API_KEY: "  ", DEEPSEEK_MODEL: "deepseek-flash" },
      { DEEPSEEK_API_KEY: KEY, DEEPSEEK_MODEL: "deepseek-chat" },
      { DEEPSEEK_API_KEY: KEY, DEEPSEEK_MODEL: "DEEPSEEK-FLASH" },
    ]) {
      expect(deepseekConfigFrom(env)).toBeUndefined();
    }
  });
});

describe("translateWithDeepSeek", () => {
  it("envía URL, modelo, stream:false y thinking desactivado fijos, sin seguir redirecciones; la clave solo en la cabecera", async () => {
    const fetchFn = reply(completion(" Hello "));
    await expect(translateWithDeepSeek(INPUT, CONFIG, fetchFn, new AbortController().signal)).resolves.toEqual({
      ok: true,
      translation: "Hello",
      upstreamStatus: 200,
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(DEEPSEEK_ENDPOINT).toBe(url);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "deepseek-flash", stream: false, thinking: { type: "disabled" } });
    expect(init?.body as string).not.toContain(KEY);
  });

  it("ignora reasoning_content separado, pero razonamiento en content, length, vacío o largo son error", async () => {
    await expect(
      translateWithDeepSeek(INPUT, CONFIG, reply(completion("Hello", "stop", { reasoning_content: "pienso" })), new AbortController().signal),
    ).resolves.toMatchObject({ ok: true, translation: "Hello" });
    for (const body of [completion("<think>x</think>Hello"), completion("Hello", "length"), completion("  "), completion("a".repeat(2001))]) {
      await expect(translateWithDeepSeek(INPUT, CONFIG, reply(body), new AbortController().signal)).resolves.toMatchObject({
        ok: false,
        code: "SERVICE_UNAVAILABLE",
      });
    }
  });

  it("estados del upstream: 401/403/3xx/5xx → SERVICE_UNAVAILABLE, 429 → BUSY; HTML y cuerpos de más de 64 KiB → error; una sola llamada", async () => {
    for (const [status, code] of [
      [401, "SERVICE_UNAVAILABLE"],
      [403, "SERVICE_UNAVAILABLE"],
      [302, "SERVICE_UNAVAILABLE"],
      [500, "SERVICE_UNAVAILABLE"],
      [429, "BUSY"],
    ] as const) {
      const fetchFn = reply("detalle interno", { status });
      await expect(translateWithDeepSeek(INPUT, CONFIG, fetchFn, new AbortController().signal)).resolves.toEqual({
        ok: false,
        code,
        upstreamStatus: status,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
    for (const fetchFn of [reply("<html>", { type: "text/html" }), reply(completion("a".repeat(70 * 1024)))]) {
      await expect(translateWithDeepSeek(INPUT, CONFIG, fetchFn, new AbortController().signal)).resolves.toMatchObject({
        ok: false,
        code: "SERVICE_UNAVAILABLE",
      });
    }
  });

  it("el plazo agotado o la cancelación abortan la petición con TIMEOUT", async () => {
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
    await expect(translateWithDeepSeek(INPUT, CONFIG, hanging, AbortSignal.timeout(20))).resolves.toMatchObject({
      ok: false,
      code: "TIMEOUT",
    });
    expect(aborted).toBe(true);
  });
});

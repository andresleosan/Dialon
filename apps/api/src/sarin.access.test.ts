import { describe, expect, it, vi } from "vitest";
import { sarinAuthFrom, translateWithSarin, type SarinAuth } from "./sarin";

// Par opcional de Cloudflare Access para Sarin: valores sintéticos, nunca reales. Un par incompleto falla cerrado.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const INPUT = { text: "Hola", source: "es", target: "en", maxChars: 2000 };

describe("Sarin con Cloudflare Access", () => {
  it("con el par completo, la autenticación lleva las credenciales de Access además del modo", () => {
    expect(
      sarinAuthFrom({ SARIN_AUTH_MODE: "none", SARIN_ACCESS_CLIENT_ID: "id-sintetico", SARIN_ACCESS_CLIENT_SECRET: "secreto-sintetico" }),
    ).toEqual({ mode: "none", access: { clientId: "id-sintetico", clientSecret: "secreto-sintetico" } });
    expect(
      sarinAuthFrom({
        SARIN_AUTH_MODE: "bearer",
        SARIN_API_KEY: "clave-sintetica",
        SARIN_ACCESS_CLIENT_ID: "id-sintetico",
        SARIN_ACCESS_CLIENT_SECRET: "secreto-sintetico",
      }),
    ).toEqual({ mode: "bearer", key: "clave-sintetica", access: { clientId: "id-sintetico", clientSecret: "secreto-sintetico" } });
  });

  it("un par incompleto o vacío deja Sarin sin configurar aunque el modo sea válido", () => {
    for (const env of [
      { SARIN_AUTH_MODE: "none", SARIN_ACCESS_CLIENT_ID: "id-sintetico" },
      { SARIN_AUTH_MODE: "none", SARIN_ACCESS_CLIENT_SECRET: "secreto-sintetico" },
      { SARIN_AUTH_MODE: "none", SARIN_ACCESS_CLIENT_ID: "  ", SARIN_ACCESS_CLIENT_SECRET: "secreto-sintetico" },
    ]) {
      expect(sarinAuthFrom(env)).toEqual({ mode: "unconfigured" });
    }
  });

  it("envía CF-Access-Client-Id/Secret en las cabeceras, nunca en el cuerpo", async () => {
    const fetchFn = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Hello" } }] }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const auth = { mode: "none", access: { clientId: "id-sintetico", clientSecret: "secreto-sintetico" } } as unknown as SarinAuth;
    await translateWithSarin(INPUT, auth, fetchFn, new AbortController().signal);
    const init = fetchFn.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("CF-Access-Client-Id")).toBe("id-sintetico");
    expect(headers.get("CF-Access-Client-Secret")).toBe("secreto-sintetico");
    expect(init?.body as string).not.toContain("secreto-sintetico");
  });
});

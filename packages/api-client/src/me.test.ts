import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./index";

// getMe(): estado de la cuenta propia según el backend. Servidor y token simulados, sin red. El rol SOLO lo decide el
// backend; el cliente nunca lo deduce del email.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type GetMe = (signal?: AbortSignal) => Promise<{ ok: boolean; code?: string; detail?: string; value?: unknown }>;

const ME = {
  uid: "uid-ficticio",
  role: "user",
  subscription: { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } },
  // Catálogo por país (apagado y vacío por defecto); ya no hay tarifa global.
  payments: { enabled: false, markets: [] },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function client(fetchFn: Fetch, token: string | null = "token-sintetico") {
  const getIdToken = vi.fn(() => Promise.resolve(token));
  const api = createApiClient({ baseUrl: "https://api.example", getIdToken, fetch: fetchFn });
  // Aún no existe: la llamada se hace dentro de una promesa para que la RED llegue a la aserción.
  const getMe = () => Promise.resolve().then(() => (api as unknown as { getMe: GetMe }).getMe());
  return { getMe, getIdToken };
}

describe("getMe", () => {
  it("hace GET /v1/me con el token, sin seguir redirecciones, y devuelve el estado validado", async () => {
    const fetchFn = vi.fn<Fetch>(() => Promise.resolve(json(ME)));
    const { getMe } = client(fetchFn);
    await expect(getMe()).resolves.toMatchObject({ ok: true, value: { role: "user", subscription: { status: "inactive" } } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example/v1/me");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-sintetico");
  });

  it("un rol desconocido o una forma inesperada es INVALID_RESPONSE", async () => {
    for (const body of [{ ...ME, role: "admin" }, { ...ME, subscription: { status: "gratis" } }, { uid: 1 }]) {
      const { getMe } = client(vi.fn<Fetch>(() => Promise.resolve(json(body))));
      await expect(getMe()).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    }
  });

  it("sin token no llama; un error del servidor se devuelve por código con mensaje fijo, sin repetir el remoto", async () => {
    const unused = vi.fn<Fetch>();
    await expect(client(unused, null).getMe()).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(unused).not.toHaveBeenCalled();

    const remote = json({ error: { code: "FORBIDDEN", message: "<b>mensaje remoto</b>" } }, 403);
    const result = await client(vi.fn<Fetch>(() => Promise.resolve(remote))).getMe();
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(JSON.stringify(result)).not.toContain("mensaje remoto");
  });
});

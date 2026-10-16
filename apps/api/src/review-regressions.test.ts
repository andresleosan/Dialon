import { describe, expect, it, vi } from "vitest";
import { sarinAuthFrom } from "./sarin";
import { handleRequest } from "./translate";
import type { Store } from "./store";

// Regresiones independientes de la revisión. Todo sintético y sin red.
describe("Access presente y plazos de persistencia", () => {
  it("cualquier mitad de Access presente pero vacía falla cerrado", () => {
    for (const fields of [
      { SARIN_ACCESS_CLIENT_ID: " " },
      { SARIN_ACCESS_CLIENT_SECRET: "" },
      { SARIN_ACCESS_CLIENT_ID: "", SARIN_ACCESS_CLIENT_SECRET: "" },
      { SARIN_ACCESS_CLIENT_ID: 123 },
    ]) expect(sarinAuthFrom({ SARIN_AUTH_MODE: "none", ...fields })).toEqual({ mode: "unconfigured" });
  });

  it("cancelar /v1/me no espera a D1 ni inicia lecturas posteriores", async () => {
    const control = new AbortController();
    const touchUser = vi.fn(() => new Promise<void>(() => undefined));
    const getSubscription = vi.fn();
    const getSettings = vi.fn();
    const store = { touchUser, getSubscription, getSettings } as unknown as Store;
    const request = new Request("https://api.example/v1/me", { signal: control.signal });
    let response: Response | undefined;
    const pending = handleRequest(request, { ALLOWED_ORIGINS: "" } as unknown as Env, {
      verifier: { verify: () => Promise.resolve({ ok: true as const, uid: "fixture-user" }) },
      fetch: vi.fn(), store, log: () => undefined,
    }).then(value => { response = value; });
    for (let n = 0; n < 12; n++) await Promise.resolve();
    expect(touchUser).toHaveBeenCalledTimes(1);
    control.abort();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(response?.status).toBe(504);
    expect(getSubscription).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
    if (response) await pending;
  });
});

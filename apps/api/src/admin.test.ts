import { parseApiError } from "@dialon/contracts";
import { describe, expect, it, vi } from "vitest";
import type { TokenOutcome } from "./firebaseToken";
import { handleRequest } from "./translate";

// Barreras de /v1/me y /v1/admin/* ANTES de tocar D1. Verificador inyectado con claims sintéticos (uid ficticio, nunca
// el real); D1 es un doble que falla la prueba si se usa. Sin red y sin Sarin configurado: estas rutas no dependen de él.

const ORIGINS = "https://dialon.pages.dev,http://localhost:8081";
const OWNER_EMAIL = "andres.san1404@gmail.com";
const OWNER_UID = "uid-propietario-ficticio";

interface Identity {
  readonly uid: string;
  readonly email?: string;
  readonly emailVerified: boolean;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function setup({
  identity,
  ownerUid = OWNER_UID,
}: { identity?: Identity | null; ownerUid?: string } = {}) {
  const outcome = identity ? { ok: true, ...identity } : { ok: false, code: "UNAUTHENTICATED" };
  const verify = vi.fn(() => Promise.resolve(outcome as unknown as TokenOutcome));
  const prepare = vi.fn(() => {
    throw new Error("D1 no debe tocarse antes de autorizar");
  });
  const upstream = vi.fn<Fetch>(() => Promise.reject(new Error("sin red")));
  const env = {
    ALLOWED_ORIGINS: ORIGINS,
    OWNER_EMAIL,
    OWNER_FIREBASE_UID: ownerUid,
    DB: { prepare, batch: prepare, exec: prepare },
    TRANSLATE_LIMITER: { limit: vi.fn(() => Promise.resolve({ success: true })) },
  } as unknown as Env;
  const logs: string[] = [];
  const deps = { verifier: { verify }, fetch: upstream, log: (line: string) => logs.push(line) };
  return { verify, prepare, upstream, logs, run: (request: Request) => handleRequest(request, env, deps) };
}

function request(method: string, path: string, { body, headers = {} }: { body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`https://api.example${path}`, {
    method,
    headers: {
      Origin: "https://dialon.pages.dev",
      Authorization: "Bearer aaa.bbb.ccc",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function codeOf(response: Response) {
  const parsed = parseApiError(await response.json());
  return parsed.ok ? parsed.value.code : "forma-inesperada";
}

const ADMIN_ROUTES: [string, string, unknown?][] = [
  ["GET", "/v1/admin/users"],
  ["PUT", "/v1/admin/users/uid-otro/subscription", { status: "active", plan: "monthly", expiresAt: 1, limits: { maxRequests: 10, maxChars: 1000 } }],
  ["GET", "/v1/admin/settings"],
  ["PUT", "/v1/admin/settings", { translation: { activeProvider: "deepseek", externalProvidersEnabled: true } }],
  ["GET", "/v1/admin/status"],
  ["GET", "/v1/admin/payment-requests"],
  ["POST", "/v1/admin/payment-requests/pr-1/approve"],
  ["POST", "/v1/admin/payment-requests/pr-1/reject"],
];

const USER: Identity = { uid: "uid-usuario-ficticio", email: "usuario@example.com", emailVerified: true };
const OWNER: Identity = { uid: OWNER_UID, email: OWNER_EMAIL, emailVerified: true };

describe("GET /v1/me", () => {
  it("sin token válido responde 401 y no toca D1 ni la red", async () => {
    const { run, prepare, upstream } = setup({ identity: null });
    const response = await run(request("GET", "/v1/me"));
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("UNAUTHENTICATED");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(prepare).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("/v1/admin/*: rol de propietario en cada ruta y método", () => {
  it("sin token, cada ruta admin responde 401 sin tocar D1", async () => {
    for (const [method, path, body] of ADMIN_ROUTES) {
      const { run, prepare } = setup({ identity: null });
      const response = await run(request(method, path, { body }));
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("un usuario autenticado que no es el propietario recibe 403 en cada ruta y método, sin tocar D1", async () => {
    for (const [method, path, body] of ADMIN_ROUTES) {
      const { run, prepare, upstream } = setup({ identity: USER });
      const response = await run(request(method, path, { body }));
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN");
      expect(prepare).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it("el propietario exige las cuatro condiciones: uid configurado y no vacío, uid igual, email igual y verificado", async () => {
    const cases: { identity: Identity; ownerUid?: string; why: string }[] = [
      { identity: OWNER, ownerUid: "", why: "OWNER_FIREBASE_UID vacío" },
      { identity: OWNER, ownerUid: "   ", why: "OWNER_FIREBASE_UID en blanco" },
      { identity: { ...OWNER, emailVerified: false }, why: "email sin verificar" },
      { identity: { ...OWNER, email: "otra@example.com" }, why: "otro email" },
      { identity: { uid: OWNER_UID, emailVerified: true }, why: "sin email" },
      { identity: { ...OWNER, uid: "uid-impostor" }, why: "mismo email, otro uid" },
      { identity: { ...USER, uid: OWNER_UID }, why: "mismo uid, otro email" },
    ];
    for (const { identity, ownerUid, why } of cases) {
      const { run, prepare } = setup({ identity, ownerUid });
      const response = await run(request("GET", "/v1/admin/users"));
      expect(response.status, why).toBe(403);
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("ni cabeceras ni cuerpo ni consulta del cliente conceden el rol", async () => {
    const { run, prepare } = setup({ identity: USER });
    const forged = await run(
      request("PUT", "/v1/admin/settings?role=owner", {
        body: { role: "owner", uid: OWNER_UID, email: OWNER_EMAIL, translation: { activeProvider: "sarin" } },
        headers: { "X-Dialon-Role": "owner", "X-Firebase-Uid": OWNER_UID, "X-Email": OWNER_EMAIL },
      }),
    );
    expect(forged.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("el preflight de rutas admin y de /v1/me concede GET, POST y PUT solo a orígenes permitidos", async () => {
    const { run, verify } = setup({ identity: USER });
    for (const path of ["/v1/admin/settings", "/v1/me"]) {
      const allowed = await run(new Request(`https://api.example${path}`, { method: "OPTIONS", headers: { Origin: "http://localhost:8081" } }));
      expect(allowed.status, path).toBe(204);
      const methods = (allowed.headers.get("Access-Control-Allow-Methods") ?? "").split(",").map((m) => m.trim());
      expect(methods).toEqual(expect.arrayContaining(["GET", "POST", "PUT"]));
      expect(allowed.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
      const foreign = await run(new Request(`https://api.example${path}`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
      expect(foreign.status).toBe(403);
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("los logs de rechazos no contienen uid ni email", async () => {
    const { run, logs } = setup({ identity: USER });
    await run(request("GET", "/v1/admin/users"));
    const all = logs.join("\n");
    expect(all).not.toContain(USER.uid);
    expect(all).not.toContain("usuario@example.com");
  });
});

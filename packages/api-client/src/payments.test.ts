import { describe, expect, it, vi } from "vitest";
import { createApiClient, RESPONSE_BUDGET } from "./index";

// Pagos por transferencia y comprobantes en el cliente: servidor y token simulados, sin red. Documentos sintéticos.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const ID = "1b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const KEY = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const PDF = new TextEncoder().encode("%PDF-1.4\nSINTETICO");
const VIEW = {
  id: ID,
  country: "JE",
  plan: "weekly",
  days: 7,
  amountMinor: 100,
  currency: "GBP",
  limits: { maxRequests: 5, maxChars: 1000 },
  status: "pending",
  createdAt: 1,
  decidedAt: null,
  receipt: null,
};
const LIMITS = { maxRequests: 5, maxChars: 1000 };

/** Mercado público FICTICIO con instrucciones largas (sin datos bancarios reales). */
function publicMarket(country: string, currency: string, instructionsLength = 1000) {
  return {
    country,
    currency,
    instructions: "F".repeat(instructionsLength),
    plans: [
      { plan: "weekly", days: 7, amountMinor: 100, limits: LIMITS },
      { plan: "biweekly", days: 14, amountMinor: 180, limits: LIMITS },
      { plan: "monthly", days: 30, amountMinor: 300, limits: LIMITS },
    ],
  };
}
const TWENTY = ["CO", "JE", "GB", "ES", "MX", "AR", "CL", "PE", "US", "CA", "FR", "DE", "IT", "PT", "BR", "EC", "UY", "PY", "BO", "VE"];

function account(payments: unknown) {
  return {
    uid: "uid-a",
    role: "user",
    subscription: { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } },
    payments,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function client(fetchFn: Fetch) {
  const getIdToken = vi.fn(() => Promise.resolve("token-sintetico"));
  return { api: createApiClient({ baseUrl: "https://api.example", getIdToken, fetch: fetchFn }), getIdToken };
}

function sent(fetchFn: ReturnType<typeof vi.fn<Fetch>>) {
  const [url, init] = fetchFn.mock.calls[0] ?? [];
  return { url, init, headers: new Headers(init?.headers) };
}

describe("presupuestos de respuesta por ruta", () => {
  it("una página de usuarios de más de 256 KiB es INVALID_RESPONSE; la traducción sigue en 16 KiB", async () => {
    expect(RESPONSE_BUDGET).toMatchObject({ small: 16 * 1024, usersPage: 256 * 1024, receipt: 5 * 1024 * 1024 });
    const huge = JSON.stringify({ users: [], nextCursor: null, relleno: "x".repeat(256 * 1024) });
    const { api } = client(() => Promise.resolve(new Response(huge)));
    await expect(api.listUsers({ limit: 50 })).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });

  it("cuenta y ajustes con 20 mercados (más de 16 KiB) caben; más de 128 KiB es INVALID_RESPONSE", async () => {
    const payments = { enabled: true, markets: TWENTY.map((country) => publicMarket(country, "EUR")) };
    const body = JSON.stringify(account(payments));
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(16 * 1024);
    const me = await client(() => Promise.resolve(new Response(body))).api.getMe();
    expect(me).toMatchObject({ ok: true });
    if (me.ok) expect((me.value.payments as unknown as { markets: unknown[] }).markets).toHaveLength(20);

    const settingsMarkets = TWENTY.map((country) => ({
      country,
      currency: "EUR",
      instructions: "F".repeat(1000),
      prices: { weekly: 100, biweekly: 180, monthly: 300 },
      planLimits: { weekly: LIMITS, biweekly: LIMITS, monthly: LIMITS },
    }));
    const settings = JSON.stringify({ translation: { activeProvider: "sarin", externalProvidersEnabled: false }, payments: { enabled: true, markets: settingsMarkets } });
    await expect(client(() => Promise.resolve(new Response(settings))).api.getSettings()).resolves.toMatchObject({ ok: true });

    const tooBig = JSON.stringify({ ...account({ enabled: false, markets: [] }), relleno: "x".repeat(128 * 1024) });
    await expect(client(() => Promise.resolve(new Response(tooBig))).api.getMe()).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });

  it("guardar un catálogo de 20 mercados envía el cuerpo completo; uno inválido no llama", async () => {
    const markets = TWENTY.map((country) => ({
      country,
      currency: "EUR",
      instructions: "F".repeat(1000),
      prices: { weekly: 100, biweekly: 180, monthly: 300 },
      planLimits: { weekly: LIMITS, biweekly: LIMITS, monthly: LIMITS },
    }));
    const reply = { translation: { activeProvider: "sarin", externalProvidersEnabled: false }, payments: { enabled: true, markets } };
    const fetchFn = vi.fn<Fetch>(() => Promise.resolve(json(reply)));
    const { api } = client(fetchFn);
    await expect(api.updateSettings({ payments: { enabled: true, markets } })).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(sent(fetchFn).init?.body as string)).toEqual({ payments: { enabled: true, markets } });

    const unused = vi.fn<Fetch>();
    const other = client(unused).api;
    for (const payments of [
      { enabled: true, markets: [] },
      { enabled: true, markets: [{ ...markets[0], country: "co" }] },
      { enabled: true, currency: "EUR", instructions: "x", prices: { weekly: 1, biweekly: 1, monthly: 1 }, planLimits: { weekly: LIMITS, biweekly: LIMITS, monthly: LIMITS } },
    ]) {
      await expect(other.updateSettings({ payments } as never)).resolves.toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("solicitudes del usuario", () => {
  it("crea con país, plan y clave (201 o 200 con la misma), sin importe, moneda ni uid en el cuerpo; devuelve el país congelado", async () => {
    for (const status of [201, 200]) {
      const fetchFn = vi.fn<Fetch>(() => Promise.resolve(json(VIEW, status)));
      const { api } = client(fetchFn);
      await expect(api.createPaymentRequest({ country: "JE", plan: "weekly", idempotencyKey: KEY } as never)).resolves.toMatchObject({
        ok: true,
        value: { id: ID, country: "JE", currency: "GBP" },
      });
      const { url, init, headers } = sent(fetchFn);
      expect(url).toBe("https://api.example/v1/me/payment-requests");
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      expect(headers.get("Authorization")).toBe("Bearer token-sintetico");
      expect(JSON.parse(init?.body as string)).toEqual({ country: "JE", plan: "weekly", idempotencyKey: KEY });
    }
  });

  it("sin país, país mal escrito, campos ajenos, plan inventado o clave no UUID no llaman", async () => {
    const fetchFn = vi.fn<Fetch>();
    const { api } = client(fetchFn);
    for (const bad of [
      { plan: "weekly", idempotencyKey: KEY },
      { country: "je", plan: "weekly", idempotencyKey: KEY },
      { country: "JEY", plan: "weekly", idempotencyKey: KEY },
      { country: "JE", plan: "weekly", idempotencyKey: KEY, amountMinor: 1 },
      { country: "JE", plan: "weekly", idempotencyKey: KEY, currency: "GBP" },
      { country: "JE", plan: "gratis", idempotencyKey: KEY },
      { country: "JE", plan: "weekly", idempotencyKey: "no-uuid" },
    ]) {
      await expect(api.createPaymentRequest(bad as never)).resolves.toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("una respuesta sin país o con un país mal formado es INVALID_RESPONSE; country null (historial) es válido", async () => {
    const withoutCountry: Record<string, unknown> = { ...VIEW };
    delete withoutCountry.country;
    for (const reply of [withoutCountry, { ...VIEW, country: "je" }]) {
      const { api } = client(() => Promise.resolve(json(reply, 201)));
      await expect(api.createPaymentRequest({ country: "JE", plan: "weekly", idempotencyKey: KEY } as never)).resolves.toMatchObject({
        ok: false,
        code: "INVALID_RESPONSE",
      });
    }
    const legacy = client(() => Promise.resolve(json({ requests: [{ ...VIEW, country: null }], nextCursor: null })));
    await expect(legacy.api.listMyPaymentRequests()).resolves.toMatchObject({ ok: true, value: { requests: [{ country: null }] } });
  });

  it("errores conocidos llegan por código con mensaje fijo", async () => {
    for (const code of ["CONFLICT", "PAYMENTS_DISABLED", "RECEIPT_EXPIRED"]) {
      const { api } = client(() => Promise.resolve(json({ error: { code, message: "<b>remoto</b>" } }, 409)));
      const result = await api.createPaymentRequest({ country: "JE", plan: "weekly", idempotencyKey: KEY } as never);
      expect(result).toMatchObject({ ok: false, code });
      expect(JSON.stringify(result)).not.toContain("remoto");
    }
  });

  it("sube el comprobante en binario con su tipo; tipo fuera de la lista, vacío o de más de 5 MiB no llama", async () => {
    const fetchFn = vi.fn<Fetch>(() => Promise.resolve(json({ ...VIEW, receipt: { type: "application/pdf", bytes: PDF.length, uploadedAt: 2, expiresAt: 3, available: true } }, 201)));
    const { api } = client(fetchFn);
    await expect(api.uploadReceipt(ID, { data: PDF, type: "application/pdf" })).resolves.toMatchObject({ ok: true });
    const { url, init, headers } = sent(fetchFn);
    expect(url).toBe(`https://api.example/v1/me/payment-requests/${ID}/receipt`);
    expect(init?.method).toBe("PUT");
    expect(headers.get("Content-Type")).toBe("application/pdf");
    expect(init?.body).toBe(PDF);

    const unused = vi.fn<Fetch>();
    const other = client(unused).api;
    for (const [id, file] of [
      [ID, { data: PDF, type: "image/svg+xml" }],
      [ID, { data: new Uint8Array(0), type: "application/pdf" }],
      [ID, { data: new Uint8Array(5 * 1024 * 1024 + 1), type: "application/pdf" }],
      ["../admin", { data: PDF, type: "application/pdf" }],
    ] as const) {
      await expect(other.uploadReceipt(id, file as never)).resolves.toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
    expect(unused).not.toHaveBeenCalled();
  });

  it("descarga: bytes con tipo de la lista y firma coherente, nombre fijo generado; tipo o firma incoherentes son INVALID_RESPONSE", async () => {
    const ok = (body: Uint8Array, type: string) => () =>
      Promise.resolve(new Response(body.slice().buffer, { headers: { "Content-Type": type, "Content-Disposition": 'attachment; filename="otro.exe"' } }));
    const result = await client(ok(PDF, "application/pdf")).api.downloadMyReceipt(ID);
    expect(result).toMatchObject({ ok: true, value: { type: "application/pdf", filename: "comprobante-1b0f6c5e.pdf" } });
    if (result.ok) expect(Array.from(result.value.bytes)).toEqual(Array.from(PDF));

    for (const fetchFn of [ok(PDF, "image/png"), ok(PDF, "text/html"), ok(new TextEncoder().encode("<svg/>"), "image/png")]) {
      await expect(client(fetchFn).api.downloadMyReceipt(ID)).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    }
    const expired = client(() => Promise.resolve(json({ error: { code: "RECEIPT_EXPIRED", message: "x" } }, 410)));
    await expect(expired.api.downloadMyReceipt(ID)).resolves.toMatchObject({ ok: false, code: "RECEIPT_EXPIRED" });
  });

  it("descarga de más de 5 MiB es INVALID_RESPONSE; cancelar durante la lectura rechaza con AbortError", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PDF);
    const tooBig = client(() => Promise.resolve(new Response(big, { headers: { "Content-Type": "application/pdf" } })));
    await expect(tooBig.api.downloadMyReceipt(ID)).resolves.toMatchObject({ ok: false, code: "INVALID_RESPONSE" });

    const controller = new AbortController();
    const stalled = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(PDF);
      },
    });
    const slow = client(() => Promise.resolve(new Response(stalled, { headers: { "Content-Type": "application/pdf" } })));
    const pending = slow.api.downloadReceiptAsOwner(ID, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("decisiones del propietario", () => {
  it("aprobar y rechazar hacen POST a su ruta y validan la solicitud devuelta", async () => {
    const decided = { ...VIEW, status: "approved", decidedAt: 5, uid: "uid-a", email: null };
    for (const [method, action] of [["approvePaymentRequest", "approve"], ["rejectPaymentRequest", "reject"]] as const) {
      const fetchFn = vi.fn<Fetch>(() => Promise.resolve(json({ request: decided })));
      const { api } = client(fetchFn);
      await expect(api[method](ID)).resolves.toMatchObject({ ok: true, value: { id: ID, uid: "uid-a" } });
      const { url, init } = sent(fetchFn);
      expect(url).toBe(`https://api.example/v1/admin/payment-requests/${ID}/${action}`);
      expect(init?.method).toBe("POST");
    }
  });

  it("lista por estado con tope; estado inventado o límite fuera de rango no llama", async () => {
    const fetchFn = vi.fn<Fetch>(() => Promise.resolve(json({ requests: [], nextCursor: null })));
    const { api } = client(fetchFn);
    await expect(api.listPaymentRequests({ status: "pending" })).resolves.toMatchObject({ ok: true });
    expect(sent(fetchFn).url).toBe("https://api.example/v1/admin/payment-requests?status=pending&limit=25");
    await expect(api.listPaymentRequests({ status: "gratis" as never })).resolves.toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    await expect(api.listPaymentRequests({ limit: 51 })).resolves.toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

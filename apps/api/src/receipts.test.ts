import { DEFAULT_PAYMENT_SETTINGS, DEFAULT_TRANSLATION_SETTINGS } from "@dialon/contracts";
import { describe, expect, it, vi } from "vitest";
import * as routes from "./paymentRoutes";
import { cleanupExpiredReceipts, handleMinePayments, type PaymentContext } from "./paymentRoutes";
import { adminPaymentRequestView, paymentRequestView, type PaymentStore, type StoredPaymentRequest } from "./paymentStore";
import type { Store } from "./store";

// Aún puede no existir: se busca por nombre para que su ausencia sea un fallo de aserción y no de importación.
type Preview = (env: object, now: number, batch?: number, maxBatches?: number) => Promise<unknown>;
function previewFn(): Preview | undefined {
  const candidate = (routes as unknown as Record<string, unknown>).previewExpiredReceipts;
  return typeof candidate === "function" ? (candidate as Preview) : undefined;
}

// Subida y retención de comprobantes con R2/D1 simulados: qué se borra y qué se conserva cuando algo falla. Documento
// sintético mínimo; nada real.

const ID = "1b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const PDF = new TextEncoder().encode("%PDF-1.4\nSINTETICO");
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const PENDING: StoredPaymentRequest = {
  id: ID,
  country: null,
  uid: "uid-a",
  email: null,
  plan: "weekly",
  days: 7,
  amountMinor: 100,
  currency: "EUR",
  limits: { maxRequests: 5, maxChars: 1000 },
  status: "pending",
  createdAt: NOW,
  decidedAt: null,
  receiptKey: null,
  receiptType: null,
  receiptBytes: null,
  receiptUploadedAt: null,
  receiptExpiresAt: null,
};

interface UploadSetup {
  readonly put?: () => Promise<object | null>;
  readonly attach?: () => Promise<boolean>;
  /** Lo que devuelve `get` tras un attach con error (reconciliación). */
  readonly afterAttach?: (key: string) => Promise<StoredPaymentRequest | null>;
}

function upload({ put = () => Promise.resolve({}), attach = () => Promise.resolve(true), afterAttach }: UploadSetup = {}) {
  let attempted: string | undefined;
  const r2 = {
    put: vi.fn<(key: string, body: unknown, options: unknown) => Promise<object | null>>((key) => {
      attempted = key;
      return put();
    }),
    delete: vi.fn<(key: string) => Promise<void>>(() => Promise.resolve()),
  };
  const attachReceipt = vi.fn(() => attach());
  let attachCalled = false;
  const get = vi.fn((): Promise<StoredPaymentRequest | null> => {
    if (attachCalled && afterAttach && attempted) return afterAttach(attempted);
    return Promise.resolve(attachCalled && attempted ? { ...PENDING, receiptKey: attempted, receiptType: "application/pdf", receiptBytes: PDF.length, receiptUploadedAt: NOW, receiptExpiresAt: NOW + 90 * DAY } : PENDING);
  });
  const payments = {
    get,
    attachReceipt: (...args: unknown[]) => {
      attachCalled = true;
      return attachReceipt(...(args as []));
    },
  } as unknown as PaymentStore;
  const retained: Promise<unknown>[] = [];
  const request = new Request(`https://api.example/v1/me/payment-requests/${ID}/receipt`, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: PDF,
  });
  const ctx = {
    request,
    env: { PROOFS: r2 },
    context: { cors: new Headers(), started: NOW, event: "me", log: () => undefined },
    token: { ok: true, uid: "uid-a" },
    store: {} as Store,
    payments,
    signal: new AbortController().signal,
    now: NOW,
    waitUntil: (promise: Promise<unknown>) => {
      retained.push(promise);
    },
  } as unknown as PaymentContext;
  const run = async () => {
    const response = await handleMinePayments(ctx, new URL(request.url).pathname);
    await Promise.all(retained);
    return response;
  };
  return { run, r2, attachReceipt, retained, key: () => attempted };
}

describe("subida del comprobante", () => {
  it("clave del servidor con fecha y uuid, escritura solo-crear y la cadena retenida con waitUntil", async () => {
    const f = upload();
    expect((await f.run()).status).toBe(201);
    const [key, , options] = f.r2.put.mock.calls[0] ?? [];
    expect(key).toMatch(new RegExp(`^receipts/${String(NOW)}-[0-9a-f-]{36}$`));
    expect(options).toMatchObject({ onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/pdf" } });
    expect(f.retained).toHaveLength(1);
    expect(f.r2.delete).not.toHaveBeenCalled();
  });

  it("si R2 falla al escribir no se borra nada (no se sabe si se escribió) ni se asocia: 503", async () => {
    const f = upload({ put: () => Promise.reject(new Error("r2")) });
    expect((await f.run()).status).toBe(503);
    expect(f.attachReceipt).not.toHaveBeenCalled();
    expect(f.r2.delete).not.toHaveBeenCalled();
  });

  it("si la asociación condicional no se cumple (otra subida ganó) se borra SOLO el objeto propio: 409", async () => {
    const f = upload({ attach: () => Promise.resolve(false) });
    expect((await f.run()).status).toBe(409);
    expect(f.r2.delete).toHaveBeenCalledTimes(1);
    expect(f.r2.delete).toHaveBeenCalledWith(f.key());
  });

  it("asociación con error: si D1 muestra nuestra clave, se conserva y se responde 201", async () => {
    const f = upload({
      attach: () => Promise.reject(new Error("d1")),
      afterAttach: (key) => Promise.resolve({ ...PENDING, receiptKey: key, receiptType: "application/pdf", receiptBytes: PDF.length, receiptUploadedAt: NOW, receiptExpiresAt: NOW + 90 * DAY }),
    });
    expect((await f.run()).status).toBe(201);
    expect(f.r2.delete).not.toHaveBeenCalled();
  });

  it("asociación con error: si la solicitud ya tiene otro comprobante, el propio se borra: 409", async () => {
    const f = upload({
      attach: () => Promise.reject(new Error("d1")),
      afterAttach: () => Promise.resolve({ ...PENDING, receiptKey: "receipts/otro", receiptUploadedAt: NOW }),
    });
    expect((await f.run()).status).toBe(409);
    expect(f.r2.delete).toHaveBeenCalledWith(f.key());
  });

  it("asociación con error e imposible de comprobar (o aún pendiente sin comprobante): se conserva para la retención: 503", async () => {
    for (const afterAttach of [() => Promise.reject(new Error("d1")), () => Promise.resolve(PENDING)]) {
      const f = upload({ attach: () => Promise.reject(new Error("d1")), afterAttach });
      expect((await f.run()).status).toBe(503);
      expect(f.r2.delete).not.toHaveBeenCalled();
    }
  });

  it("un fallo al borrar lo propio no rompe la cadena ni deja rechazos sin manejar", async () => {
    const f = upload({ attach: () => Promise.resolve(false) });
    f.r2.delete.mockImplementation(() => Promise.reject(new Error("r2")));
    expect((await f.run()).status).toBe(409);
  });
});

describe("creación idempotente", () => {
  // Solicitud previa con país congelado (el campo `country` lo añade la migración 0004).
  const PREVIOUS: StoredPaymentRequest = { ...PENDING, country: "CO", currency: "COP", amountMinor: 5_000_000 };

  function create(previous: StoredPaymentRequest | null, plan: string, country = "CO") {
    const getSettings = vi.fn(() => Promise.reject(new Error("no debe leerse")));
    const payments = { findByKey: vi.fn(() => Promise.resolve(previous)) } as unknown as PaymentStore;
    const request = new Request("https://api.example/v1/me/payment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country, plan, idempotencyKey: ID }),
    });
    const ctx = {
      request,
      env: {},
      context: { cors: new Headers(), started: NOW, event: "me", log: () => undefined },
      token: { ok: true, uid: "uid-a" },
      store: { getSettings } as unknown as Store,
      payments,
      signal: new AbortController().signal,
      now: NOW,
      waitUntil: () => undefined,
    } as unknown as PaymentContext;
    return { response: handleMinePayments(ctx, "/v1/me/payment-requests"), getSettings };
  }

  it("con la misma clave, país y plan devuelve la existente (200) sin leer la configuración actual; otro plan u otro país, 409", async () => {
    const same = create(PREVIOUS, "weekly");
    const response = await same.response;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ID, country: "CO", currency: "COP", amountMinor: 5_000_000 });
    expect(same.getSettings).not.toHaveBeenCalled();

    const otherPlan = create(PREVIOUS, "monthly");
    expect((await otherPlan.response).status).toBe(409);
    expect(otherPlan.getSettings).not.toHaveBeenCalled();

    const otherCountry = create(PREVIOUS, "weekly", "JE");
    expect((await otherCountry.response).status).toBe(409);
    expect(otherCountry.getSettings).not.toHaveBeenCalled();
  });

  it("sin país, o con moneda o importe del cliente, 400 sin tocar nada", async () => {
    for (const body of [{ plan: "weekly", idempotencyKey: ID }, { country: "CO", plan: "weekly", idempotencyKey: ID, currency: "COP" }, { country: "CO", plan: "weekly", idempotencyKey: ID, amountMinor: 1 }]) {
      const findByKey = vi.fn(() => Promise.resolve(null));
      const ctx = {
        request: new Request("https://api.example/v1/me/payment-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        env: {},
        context: { cors: new Headers(), started: NOW, event: "me", log: () => undefined },
        token: { ok: true, uid: "uid-a" },
        store: { getSettings: vi.fn(() => Promise.resolve({ payments: DEFAULT_PAYMENT_SETTINGS, translation: DEFAULT_TRANSLATION_SETTINGS })) } as unknown as Store,
        payments: { findByKey } as unknown as PaymentStore,
        signal: new AbortController().signal,
        now: NOW,
        waitUntil: () => undefined,
      } as unknown as PaymentContext;
      expect((await handleMinePayments(ctx, "/v1/me/payment-requests")).status).toBe(400);
      expect(findByKey).not.toHaveBeenCalled();
    }
  });
});

describe("limpieza de retención", () => {
  const old = NOW - 91 * DAY;
  const uuid = () => crypto.randomUUID();
  const enabledGuard: Record<string, unknown> = { RECEIPT_PURGE_ENABLED: "true" };

  // La purga solo se autoriza con la cadena exacta "true"; estas pruebas de borrado la activan explícitamente.
  function env({
    expired = [] as { id: string; proof_key: string }[],
    objects = [] as { key: string; uploaded: Date }[][],
    referenced = new Set<string>(),
    failDelete = new Set<string>(),
    guard = enabledGuard,
  } = {}) {
    const forgotten: string[] = [];
    const writes: string[] = [];
    let expiredServed = false;
    const prepare = (sql: string) => {
      let binds: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => {
          binds = values;
          return statement;
        },
        all: () => {
          // El primer lote devuelve los vencidos; después ya no queda ninguno referenciado.
          const results = sql.includes("receipt_expires_at <=") && !expiredServed ? expired.map(row => ({ ...row, receipt_expires_at: NOW - 1 })) : [];
          if (sql.includes("receipt_expires_at <=")) expiredServed = true;
          return Promise.resolve({ results });
        },
        first: () => Promise.resolve(sql.includes("proof_key = ?1") && referenced.has(String(binds[0])) ? { found: 1 } : null),
        run: () => {
          writes.push(sql);
          if (sql.includes("proof_key = NULL")) forgotten.push(String(binds[1]));
          return Promise.resolve({ meta: { changes: 1 } });
        },
      };
      return statement;
    };
    const deleted: string[] = [];
    const list = vi.fn((options: { cursor?: string }) => {
      const index = options.cursor === undefined ? 0 : Number(options.cursor);
      const page = objects[index] ?? [];
      const truncated = index + 1 < objects.length;
      return Promise.resolve({ objects: page, truncated, ...(truncated ? { cursor: String(index + 1) } : {}) });
    });
    const bucket = {
      put: vi.fn(),
      list,
      delete: vi.fn((key: string) => {
        if (failDelete.has(key)) return Promise.reject(new Error("r2"));
        deleted.push(key);
        return Promise.resolve();
      }),
    };
    const batch = vi.fn(() => Promise.resolve([]));
    return { value: { DB: { prepare, batch }, PROOFS: bucket, ...guard }, deleted, forgotten, writes, batch, list };
  }

  it("sin RECEIPT_PURGE_ENABLED === \"true\" exacto no borra, no olvida referencias ni escribe cursores", async () => {
    const key = `receipts/${String(old)}-${uuid()}`;
    for (const guard of [{}, { RECEIPT_PURGE_ENABLED: "false" }, { RECEIPT_PURGE_ENABLED: true }, { RECEIPT_PURGE_ENABLED: "TRUE" }, { RECEIPT_PURGE_ENABLED: "1" }, { RECEIPT_PURGE_ENABLED: " true" }, { RECEIPT_PURGE_ENABLED: "yes" }]) {
      const e = env({ guard, expired: [{ id: "a", proof_key: key }], objects: [[{ key, uploaded: new Date(old) }]] });
      await expect(cleanupExpiredReceipts(e.value, NOW)).resolves.toBe(0);
      expect(e.deleted).toEqual([]);
      expect(e.forgotten).toEqual([]);
      expect(e.writes).toEqual([]);
      expect(e.batch).not.toHaveBeenCalled();
      expect(e.list).not.toHaveBeenCalled();
    }
  });

  it("previsualización: solo contadores agregados, sin borrar, sin olvidar referencias ni escribir cursores, también sin guarda", async () => {
    const preview = previewFn();
    expect(typeof preview).toBe("function");
    if (!preview) return;
    const expiredKey = `receipts/${String(old)}-${uuid()}`;
    const orphan = `receipts/${String(old)}-${uuid()}`;
    for (const guard of [{}, { RECEIPT_PURGE_ENABLED: "false" }]) {
      const e = env({
        guard,
        expired: [{ id: "a", proof_key: expiredKey }],
        referenced: new Set([expiredKey]),
        objects: [[{ key: expiredKey, uploaded: new Date(old) }, { key: orphan, uploaded: new Date(old) }, { key: "receipts/ajeno.pdf", uploaded: new Date(old) }]],
      });
      const result = await preview(e.value, NOW);
      expect(result).toEqual({ expiredReceipts: 1, orphanReceipts: 1, hasMore: false });
      expect(JSON.stringify(result)).not.toContain("receipts/");
      expect(e.deleted).toEqual([]);
      expect(e.forgotten).toEqual([]);
      expect(e.writes).toEqual([]);
      expect(e.batch).not.toHaveBeenCalled();
    }
  });

  it("vencidos referenciados: borra en R2 y luego quita la referencia; si el borrado falla, conserva la referencia y sigue", async () => {
    const ok = `receipts/${String(old)}-${uuid()}`;
    const failing = `receipts/${String(old)}-${uuid()}`;
    const e = env({ expired: [{ id: "a", proof_key: failing }, { id: "b", proof_key: ok }], failDelete: new Set([failing]) });
    expect(await cleanupExpiredReceipts(e.value, NOW)).toBe(1);
    expect(e.deleted).toEqual([ok]);
    expect(e.forgotten).toEqual([ok]);
  });

  it("huérfanos: borra solo claves de la app, sin referencia y con fecha y subida de más de 90 días; recorre todas las páginas", async () => {
    const orphanA = `receipts/${String(old)}-${uuid()}`;
    const orphanB = `receipts/${String(old + 1)}-${uuid()}`;
    const stillReferenced = `receipts/${String(old)}-${uuid()}`;
    const reuploaded = `receipts/${String(old)}-${uuid()}`;
    const recent = `receipts/${String(NOW - DAY)}-${uuid()}`;
    const later = `receipts/${String(NOW)}-${uuid()}`;
    const e = env({
      referenced: new Set([stillReferenced]),
      objects: [
        [
          { key: orphanA, uploaded: new Date(old) },
          { key: stillReferenced, uploaded: new Date(old) },
          { key: "receipts/ajeno.pdf", uploaded: new Date(old) },
          // Clave antigua pero objeto subido recientemente: no se toca.
          { key: reuploaded, uploaded: new Date(NOW - DAY) },
        ],
        [
          { key: orphanB, uploaded: new Date(old) },
          { key: recent, uploaded: new Date(NOW - DAY) },
          { key: later, uploaded: new Date(NOW) },
        ],
      ],
    });
    expect(await cleanupExpiredReceipts(e.value, NOW)).toBe(2);
    expect(e.deleted).toEqual([orphanA, orphanB]);
    expect(e.list).toHaveBeenCalledTimes(2);
  });

  it("con la guarda activa, una ejecución sin nada vencido tampoco borra objetos referenciados", async () => {
    const key = `receipts/${String(old)}-${uuid()}`;
    const e = env({ referenced: new Set([key]), objects: [[{ key, uploaded: new Date(old) }]] });
    await expect(cleanupExpiredReceipts(e.value, NOW)).resolves.toBe(0);
    expect(e.deleted).toEqual([]);
  });

  it("si R2 no lista, no lanza ni borra nada", async () => {
    const e = env();
    e.list.mockImplementation(() => Promise.reject(new Error("r2")));
    await expect(cleanupExpiredReceipts(e.value, NOW)).resolves.toBe(0);
    expect(e.deleted).toEqual([]);
  });
});

describe("disponibilidad del comprobante en las vistas", () => {
  const stored = (status: StoredPaymentRequest["status"], expiresAt: number): StoredPaymentRequest => ({
    ...PENDING,
    status,
    decidedAt: status === "pending" ? null : NOW - DAY,
    receiptKey: `receipts/${String(expiresAt - 90 * DAY)}-${ID}`,
    receiptType: "application/pdf",
    receiptBytes: PDF.length,
    receiptUploadedAt: expiresAt - 90 * DAY,
    receiptExpiresAt: expiresAt,
  });

  it("una solicitud pendiente conserva su comprobante disponible aunque pasen 90 días (autor y propietario)", () => {
    const old = stored("pending", NOW - DAY);
    expect(paymentRequestView(old, NOW).receipt).toMatchObject({ available: true });
    expect(adminPaymentRequestView(old, NOW).receipt).toMatchObject({ available: true });
  });

  it("aprobadas y rechazadas: disponible hasta subida + 90 días y no después", () => {
    for (const status of ["approved", "rejected"] as const) {
      expect(paymentRequestView(stored(status, NOW + DAY), NOW).receipt).toMatchObject({ available: true });
      expect(paymentRequestView(stored(status, NOW - DAY), NOW).receipt).toMatchObject({ available: false });
      expect(adminPaymentRequestView(stored(status, NOW - DAY), NOW).receipt).toMatchObject({ available: false });
    }
  });

  async function download(request: StoredPaymentRequest, uid = "uid-a") {
    const get = vi.fn(() => Promise.resolve({ size: PDF.length, body: new Blob([PDF]).stream() }));
    const ctx = {
      request: new Request(`https://api.example/v1/me/payment-requests/${ID}/receipt`),
      env: { PROOFS: { put: vi.fn(), get } },
      context: { cors: new Headers(), started: NOW, event: "me", log: () => undefined },
      token: { ok: true, uid },
      store: {} as Store,
      payments: { get: () => Promise.resolve(request) } as unknown as PaymentStore,
      signal: new AbortController().signal,
      now: NOW,
      waitUntil: () => undefined,
    } as unknown as PaymentContext;
    const response = await handleMinePayments(ctx, `/v1/me/payment-requests/${ID}/receipt`);
    return { status: response.status, type: response.headers.get("Content-Type"), get };
  }

  it("descarga del autor: pendiente antiguo 200; aprobada o rechazada vencida 410 sin leer R2; otra cuenta 404", async () => {
    expect(await download(stored("pending", NOW - DAY))).toMatchObject({ status: 200, type: "application/pdf" });
    for (const status of ["approved", "rejected"] as const) {
      const expired = await download(stored(status, NOW - DAY));
      expect(expired.status).toBe(410);
      expect(expired.get).not.toHaveBeenCalled();
      expect((await download(stored(status, NOW + DAY))).status).toBe(200);
    }
    const foreign = await download(stored("pending", NOW - DAY), "uid-otra");
    expect(foreign.status).toBe(404);
    expect(foreign.get).not.toHaveBeenCalled();
  });

  it("sin referencia (ya purgado) nunca está disponible, tampoco si está pendiente", () => {
    expect(paymentRequestView({ ...stored("pending", NOW - DAY), receiptKey: null }, NOW).receipt).toMatchObject({ available: false });
  });
});

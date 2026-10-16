import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_TEXT_TRANSLATION_LIMITS,
  parseAdminStatus,
  parseCreatePaymentRequest,
  parseMeResponse,
  parsePaymentRequestView,
  parseSettingsUpdate,
  parseTextTranslationResult,
  publicPayments,
  sniffReceipt,
} from "./index";

// Contratos de pagos por transferencia (catálogo por país), estado de proveedores y metadatos de origen de la
// traducción. Importes, monedas e instrucciones FICTICIOS.

const ascii = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0));
const LIMITS = { maxRequests: 5, maxChars: 1000 };
const PLAN_LIMITS = { weekly: LIMITS, biweekly: LIMITS, monthly: LIMITS };

function market(country: string, currency: string, extra: Record<string, unknown> = {}) {
  return {
    country,
    currency,
    instructions: `DATOS FICTICIOS ${country}`,
    prices: { weekly: 100, biweekly: 180, monthly: 300 },
    planLimits: PLAN_LIMITS,
    ...extra,
  };
}

const CO = market("CO", "COP", { prices: { weekly: 5_000_000, biweekly: 9_000_000, monthly: 15_000_000 } });
const JE = market("JE", "GBP");
const CATALOG = { enabled: true, markets: [CO, JE] };
const DRAFT = { country: "MX", currency: "MXN", instructions: "", prices: { weekly: null, biweekly: null, monthly: null }, planLimits: { weekly: null, biweekly: null, monthly: null } };
const COUNTRIES = ["CO", "JE", "GB", "ES", "MX", "AR", "CL", "PE", "US", "CA", "FR", "DE", "IT", "PT", "BR", "EC", "UY", "PY", "BO", "VE", "CR"];

const parsesPayments = (payments: unknown) => parseSettingsUpdate({ payments }).ok;

describe("ajustes de pago: catálogo por país", () => {
  it("por defecto: apagado y sin mercados, sin tarifa global", () => {
    expect(DEFAULT_PAYMENT_SETTINGS).toEqual({ enabled: false, markets: [] });
  });

  it("un catálogo CO/COP y JE/GBP completo se acepta tal cual", () => {
    expect(parseSettingsUpdate({ payments: CATALOG })).toEqual({ ok: true, value: { payments: CATALOG } });
  });

  it("apagado admite catálogo vacío o mercados en borrador; encendido exige al menos un mercado completo", () => {
    expect(parsesPayments({ enabled: false, markets: [] })).toBe(true);
    expect(parsesPayments({ enabled: false, markets: [DRAFT] })).toBe(true);
    expect(parsesPayments({ enabled: true, markets: [] })).toBe(false);
    expect(parsesPayments({ enabled: true, markets: [CO, DRAFT] })).toBe(false);
    for (const incomplete of [
      market("CO", "COP", { prices: { weekly: 100, biweekly: 180, monthly: null } }),
      market("CO", "COP", { planLimits: { ...PLAN_LIMITS, biweekly: null } }),
      market("CO", "COP", { instructions: "   " }),
      market("CO", "COP", { prices: { weekly: 100, biweekly: 180 } }),
    ]) {
      expect(parsesPayments({ enabled: true, markets: [incomplete] })).toBe(false);
    }
  });

  it("país: dos letras mayúsculas y único; moneda: código ISO admitido", () => {
    for (const country of ["co", "COL", "", "C1", "C"]) expect(parsesPayments({ enabled: true, markets: [market(country, "COP")] })).toBe(false);
    expect(parsesPayments({ enabled: true, markets: [CO, market("CO", "USD")] })).toBe(false);
    for (const currency of ["cop", "XYZ", "EURO", "", "12A"]) expect(parsesPayments({ enabled: true, markets: [market("CO", currency)] })).toBe(false);
  });

  it("importes enteros positivos en unidad menor con tope; cuotas con sus topes; sin campos ajenos", () => {
    for (const weekly of [0, -1, 1.5, "100", 100_000_001]) {
      expect(parsesPayments({ enabled: true, markets: [market("JE", "GBP", { prices: { weekly, biweekly: 180, monthly: 300 } })] })).toBe(false);
    }
    for (const weekly of [{ maxRequests: 0, maxChars: 10 }, { maxRequests: 100_001, maxChars: 10 }, { ...LIMITS, extra: 1 }, { maxRequests: 1.5, maxChars: 10 }]) {
      expect(parsesPayments({ enabled: true, markets: [market("JE", "GBP", { planLimits: { ...PLAN_LIMITS, weekly } })] })).toBe(false);
    }
    expect(parsesPayments({ enabled: true, markets: [market("JE", "GBP", { amountMinor: 1 })] })).toBe(false);
    expect(parsesPayments({ enabled: true, markets: [market("JE", "GBP", { instructions: "x".repeat(1001) })] })).toBe(false);
    expect(parsesPayments({ ...CATALOG, currency: "EUR" })).toBe(false);
  });

  it("como mucho 20 mercados", () => {
    const many = (n: number) => COUNTRIES.slice(0, n).map((country) => market(country, "EUR"));
    expect(parsesPayments({ enabled: true, markets: many(20) })).toBe(true);
    expect(parsesPayments({ enabled: true, markets: many(21) })).toBe(false);
  });

  it("la tarifa global antigua ya no es un ajuste válido: nunca se asigna a un país", () => {
    const legacy = {
      enabled: true,
      currency: "EUR",
      instructions: "DATOS FICTICIOS",
      prices: { weekly: 100, biweekly: 180, monthly: 300 },
      planLimits: PLAN_LIMITS,
    };
    expect(parsesPayments(legacy)).toBe(false);
    expect(parsesPayments({ ...legacy, markets: [] })).toBe(false);
  });

  it("lo público: por país, con moneda, instrucciones y planes de 7/14/30 días; nada si está apagado", () => {
    expect(publicPayments(CATALOG)).toEqual({
      enabled: true,
      markets: [
        {
          country: "CO",
          currency: "COP",
          instructions: "DATOS FICTICIOS CO",
          plans: [
            { plan: "weekly", days: 7, amountMinor: 5_000_000, limits: LIMITS },
            { plan: "biweekly", days: 14, amountMinor: 9_000_000, limits: LIMITS },
            { plan: "monthly", days: 30, amountMinor: 15_000_000, limits: LIMITS },
          ],
        },
        {
          country: "JE",
          currency: "GBP",
          instructions: "DATOS FICTICIOS JE",
          plans: [
            { plan: "weekly", days: 7, amountMinor: 100, limits: LIMITS },
            { plan: "biweekly", days: 14, amountMinor: 180, limits: LIMITS },
            { plan: "monthly", days: 30, amountMinor: 300, limits: LIMITS },
          ],
        },
      ],
    });
    expect(publicPayments({ ...CATALOG, enabled: false })).toEqual({ enabled: false, markets: [] });
  });

  it("la cuenta (/v1/me) valida el catálogo público por país", () => {
    const account = (payments: unknown) => ({
      uid: "uid-a",
      role: "user",
      subscription: { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } },
      payments,
    });
    const published = publicPayments(CATALOG);
    expect(parseMeResponse(account(published))).toMatchObject({ ok: true, value: { payments: published } });
    expect(parseMeResponse(account({ enabled: false, markets: [] })).ok).toBe(true);
    expect(parseMeResponse(account({ enabled: false, currency: "", instructions: "", plans: [] })).ok).toBe(false);
    const bad = { enabled: true, markets: [{ country: "co", currency: "COP", instructions: "x", plans: [] }] };
    expect(parseMeResponse(account(bad)).ok).toBe(false);
  });
});

describe("solicitudes y comprobantes", () => {
  const KEY = "5C6D7E8F-9A0B-4C1D-8E2F-3A4B5C6D7E8F";

  it("crear exige país, plan de pago y clave UUID (normalizada); nada de importe, moneda, uid ni prueba gratuita", () => {
    expect(parseCreatePaymentRequest({ country: "CO", plan: "monthly", idempotencyKey: KEY })).toEqual({
      ok: true,
      value: { country: "CO", plan: "monthly", idempotencyKey: KEY.toLowerCase() },
    });
    for (const bad of [
      { plan: "monthly", idempotencyKey: KEY },
      { country: "co", plan: "monthly", idempotencyKey: KEY },
      { country: "COL", plan: "monthly", idempotencyKey: KEY },
      { country: "", plan: "monthly", idempotencyKey: KEY },
      { country: "CO", plan: "custom", idempotencyKey: KEY },
      { country: "CO", plan: "trial", idempotencyKey: KEY },
      { country: "CO", plan: "weekly", idempotencyKey: "abc" },
      { country: "CO", plan: "weekly", idempotencyKey: KEY, amountMinor: 1 },
      { country: "CO", plan: "weekly", idempotencyKey: KEY, currency: "COP" },
      { country: "CO", plan: "weekly", idempotencyKey: KEY, uid: "otro" },
    ]) {
      expect(parseCreatePaymentRequest(bad).ok).toBe(false);
    }
  });

  it("la firma real decide el tipo: PDF, PNG y JPEG; vacío, HTML y SVG no", () => {
    const bytes = (...values: number[]) => new Uint8Array(values);
    expect(sniffReceipt(ascii("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffReceipt(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffReceipt(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    for (const text of ["", "<html>", '<svg xmlns="http://www.w3.org/2000/svg"/>', "%PD"]) {
      expect(sniffReceipt(ascii(text))).toBeUndefined();
    }
  });

  it("la vista incluye el país congelado: dos letras mayúsculas, o null solo en historial sin país", () => {
    const view = {
      id: "1b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b",
      country: "CO",
      plan: "weekly",
      days: 7,
      amountMinor: 5_000_000,
      currency: "COP",
      limits: LIMITS,
      status: "pending",
      createdAt: 1,
      decidedAt: null,
      receipt: null,
    };
    expect(parsePaymentRequestView(view)).toMatchObject({ ok: true, value: { country: "CO", currency: "COP" } });
    expect(parsePaymentRequestView({ ...view, country: null })).toMatchObject({ ok: true, value: { country: null } });
    for (const country of ["co", "COL", "", 1]) expect(parsePaymentRequestView({ ...view, country }).ok).toBe(false);
    const withoutCountry: Record<string, unknown> = { ...view };
    delete withoutCountry.country;
    expect(parsePaymentRequestView(withoutCountry).ok).toBe(false);
  });

  it("la vista exige días coherentes con el plan y un comprobante bien formado", () => {
    const view = {
      id: "1b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b",
      country: "JE",
      plan: "weekly",
      days: 7,
      amountMinor: 100,
      currency: "EUR",
      limits: LIMITS,
      status: "pending",
      createdAt: 1,
      decidedAt: null,
      receipt: { type: "application/pdf", bytes: 10, uploadedAt: 1, expiresAt: 2, available: true },
    };
    expect(parsePaymentRequestView(view).ok).toBe(true);
    expect(parsePaymentRequestView({ ...view, days: 30 }).ok).toBe(false);
    expect(parsePaymentRequestView({ ...view, receipt: { ...view.receipt, type: "image/svg+xml" } }).ok).toBe(false);
    expect(parsePaymentRequestView({ ...view, status: "trial" }).ok).toBe(false);
  });
});

describe("estado de proveedores y origen de la traducción", () => {
  const provider = { configured: true, state: "verified", lastSuccessAt: 5 };

  it("lastFailureAt es opcional (null si falta) y, si viene, debe ser una fecha", () => {
    const status = parseAdminStatus({ activeProvider: "sarin", providers: { sarin: provider, deepseek: { ...provider, lastFailureAt: 9 } } });
    expect(status).toMatchObject({ ok: true, value: { providers: { sarin: { lastFailureAt: null }, deepseek: { lastFailureAt: 9 } } } });
    expect(parseAdminStatus({ activeProvider: "sarin", providers: { sarin: provider, deepseek: { ...provider, lastFailureAt: "ayer" } } }).ok).toBe(false);
  });

  it("el resultado puede indicar proveedor y procesamiento, siempre coherentes", () => {
    const base = { requestId: "6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f809a1b", translation: "Olá", mode: "real", timingsMs: { total: 1 } };
    const limits = DEFAULT_TEXT_TRANSLATION_LIMITS;
    expect(parseTextTranslationResult(base, limits).ok).toBe(true);
    expect(parseTextTranslationResult({ ...base, provider: "deepseek", processing: "external" }, limits)).toMatchObject({
      ok: true,
      value: { provider: "deepseek", processing: "external" },
    });
    expect(parseTextTranslationResult({ ...base, provider: "deepseek", processing: "owner_hosted" }, limits).ok).toBe(false);
    expect(parseTextTranslationResult({ ...base, provider: "gemini", processing: "external" }, limits).ok).toBe(false);
    expect(parseTextTranslationResult({ ...base, processing: "external" }, limits).ok).toBe(false);
  });
});

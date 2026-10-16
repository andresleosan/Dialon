import { ADMIN_CAPS, PAYMENT_PLAN_DAYS, isCountry, isUid, type PaymentPlan, type SubscriptionLimits } from "./account";
import type { ErrorCode } from "./errors";
import type { ParseResult } from "./parse";

// Solicitudes de suscripción por transferencia y su comprobante privado. Nada se activa al crear la solicitud ni al
// subir el comprobante: solo la aprobación manual del propietario. Sin pasarela de pago, sin prueba gratuita.

export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
/** Retención propuesta del comprobante: 90 días desde la subida; después se deniega y se borra. */
export const RECEIPT_RETENTION_DAYS = 90;

export const PAYMENT_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_PAGE = { mineDefault: 10, mineMax: 20, adminDefault: 25, adminMax: 50 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_PLANS = Object.keys(PAYMENT_PLAN_DAYS) as PaymentPlan[];

export interface CreatePaymentRequest {
  /** País elegido explícitamente por el usuario; el servidor busca SU tarifa (nunca la de otro país). */
  readonly country: string;
  readonly plan: PaymentPlan;
  /** UUID generado por el cliente: repetir la misma petición devuelve la misma solicitud. */
  readonly idempotencyKey: string;
}

export interface ReceiptInfo {
  readonly type: ReceiptType;
  readonly bytes: number;
  readonly uploadedAt: number;
  readonly expiresAt: number;
  /** `false` si pasó la retención o ya se borró. */
  readonly available: boolean;
}

/**
 * Copia del servidor al crear la solicitud: país, importe, moneda, duración y cuota no cambian si luego cambian los
 * ajustes. `country` es `null` solo en solicitudes anteriores a los precios por país (sin país registrado).
 */
export interface PaymentRequestView {
  readonly id: string;
  readonly country: string | null;
  readonly plan: PaymentPlan;
  readonly days: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly limits: SubscriptionLimits;
  readonly status: PaymentRequestStatus;
  readonly createdAt: number;
  readonly decidedAt: number | null;
  readonly receipt: ReceiptInfo | null;
}

export interface AdminPaymentRequestView extends PaymentRequestView {
  readonly uid: string;
  readonly email: string | null;
}

export interface PaymentRequestsPage<T extends PaymentRequestView = PaymentRequestView> {
  readonly requests: readonly T[];
  readonly nextCursor: string | null;
}

function fail(code: ErrorCode, detail: string): ParseResult<never> {
  return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Cuerpo de `POST /v1/me/payment-requests`: estricto, solo `country`, `plan` e `idempotencyKey` (sin importe ni moneda). */
export function parseCreatePaymentRequest(input: unknown): ParseResult<CreatePaymentRequest> {
  if (!isRecord(input) || !Object.keys(input).every((key) => key === "country" || key === "plan" || key === "idempotencyKey")) {
    return fail("INVALID_REQUEST", "solicitud con forma inválida");
  }
  const { country, plan, idempotencyKey } = input;
  if (!isCountry(country)) return fail("INVALID_REQUEST", "país inválido");
  if (!oneOf(PAYMENT_PLANS, plan)) return fail("INVALID_REQUEST", "plan inválido");
  if (!isUuid(idempotencyKey)) return fail("INVALID_REQUEST", "clave de idempotencia inválida");
  return { ok: true, value: { country, plan, idempotencyKey: idempotencyKey.toLowerCase() } };
}

/**
 * Tipo real del comprobante por su firma (no por el nombre ni por lo que declara el cliente): PDF `%PDF-`, PNG con su
 * cabecera de 8 bytes, JPEG `FF D8 FF`. Cualquier otra cosa (vacío, HTML, SVG…) → `undefined`.
 */
export function sniffReceipt(bytes: Uint8Array): ReceiptType | undefined {
  const starts = (signature: readonly number[]) =>
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  return undefined;
}

function parseReceipt(input: unknown): ReceiptInfo | null | undefined {
  if (input === null) return null;
  if (!isRecord(input)) return undefined;
  const { type, bytes, uploadedAt, expiresAt, available } = input;
  if (!oneOf(RECEIPT_TYPES, type) || !isCount(bytes, RECEIPT_MAX_BYTES) || bytes === 0) return undefined;
  if (!isTimestamp(uploadedAt) || !isTimestamp(expiresAt) || typeof available !== "boolean") return undefined;
  return { type, bytes, uploadedAt, expiresAt, available };
}

function parseRequest(input: unknown): PaymentRequestView | undefined {
  if (!isRecord(input)) return undefined;
  const { id, plan, days, amountMinor, currency, limits, status, createdAt } = input;
  if (!isUuid(id) || !oneOf(PAYMENT_PLANS, plan) || days !== PAYMENT_PLAN_DAYS[plan]) return undefined;
  // Obligatorio: país de dos letras, o `null` explícito en el historial sin país.
  const country = input.country === null ? null : isCountry(input.country) ? input.country : undefined;
  if (country === undefined) return undefined;
  if (!isCount(amountMinor, ADMIN_CAPS.maxPriceMinor) || amountMinor === 0) return undefined;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return undefined;
  if (!isRecord(limits) || !isCount(limits.maxRequests, ADMIN_CAPS.maxRequests) || !isCount(limits.maxChars, ADMIN_CAPS.maxChars)) {
    return undefined;
  }
  if (!oneOf(PAYMENT_REQUEST_STATUSES, status) || !isTimestamp(createdAt)) return undefined;
  const decidedAt = input.decidedAt === null ? null : isTimestamp(input.decidedAt) ? input.decidedAt : undefined;
  const receipt = parseReceipt(input.receipt);
  if (decidedAt === undefined || receipt === undefined) return undefined;
  return {
    id,
    country,
    plan,
    days: PAYMENT_PLAN_DAYS[plan],
    amountMinor,
    currency,
    limits: { maxRequests: limits.maxRequests, maxChars: limits.maxChars },
    status,
    createdAt,
    decidedAt,
    receipt,
  };
}

export function parsePaymentRequestView(input: unknown): ParseResult<PaymentRequestView> {
  const request = parseRequest(input);
  return request ? { ok: true, value: request } : fail("INVALID_RESPONSE", "solicitud inválida");
}

function parseCursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isUid(value) ? value : undefined;
}

export function parsePaymentRequestsPage(input: unknown): ParseResult<PaymentRequestsPage> {
  if (!isRecord(input) || !Array.isArray(input.requests) || input.requests.length > PAYMENT_PAGE.mineMax) {
    return fail("INVALID_RESPONSE", "solicitudes con forma inválida");
  }
  const nextCursor = parseCursor(input.nextCursor);
  if (nextCursor === undefined) return fail("INVALID_RESPONSE", "cursor inválido");
  const requests: PaymentRequestView[] = [];
  for (const item of input.requests as unknown[]) {
    const request = parseRequest(item);
    if (!request) return fail("INVALID_RESPONSE", "solicitud inválida");
    requests.push(request);
  }
  return { ok: true, value: { requests, nextCursor } };
}

export function parseAdminPaymentRequestsPage(input: unknown): ParseResult<PaymentRequestsPage<AdminPaymentRequestView>> {
  if (!isRecord(input) || !Array.isArray(input.requests) || input.requests.length > PAYMENT_PAGE.adminMax) {
    return fail("INVALID_RESPONSE", "solicitudes con forma inválida");
  }
  const nextCursor = parseCursor(input.nextCursor);
  if (nextCursor === undefined) return fail("INVALID_RESPONSE", "cursor inválido");
  const requests: AdminPaymentRequestView[] = [];
  for (const item of input.requests as unknown[]) {
    const request = parseRequest(item);
    if (!request || !isRecord(item) || !isUid(item.uid)) return fail("INVALID_RESPONSE", "solicitud inválida");
    const email = item.email === null ? null : typeof item.email === "string" && item.email.length <= 320 ? item.email : undefined;
    if (email === undefined) return fail("INVALID_RESPONSE", "solicitud inválida");
    requests.push({ ...request, uid: item.uid, email });
  }
  return { ok: true, value: { requests, nextCursor } };
}

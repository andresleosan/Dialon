import type { ErrorCode } from "./errors";
import { isSupportedCurrency } from "./money";
import type { ParseResult } from "./parse";

// Cuenta propia, suscripción manual y ajustes del propietario. Las ENTRADAS (cuerpos que envía el cliente) son
// estrictas: rechazan propiedades ajenas. Las RESPUESTAS proyectan solo los campos conocidos. `detail` nunca repite el
// valor recibido.

export const ROLES = ["owner", "user"] as const;
export type Role = (typeof ROLES)[number];

/** Estado guardado. `expired` solo existe en las vistas: es un `active` con `expiresAt` pasado. */
export const SUBSCRIPTION_STATUSES = ["active", "suspended", "inactive"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionViewStatus = SubscriptionStatus | "expired";

export const SUBSCRIPTION_PLANS = ["weekly", "biweekly", "monthly", "custom"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** Planes que un usuario puede solicitar por transferencia (fase 2), con su duración en días. */
export const PAYMENT_PLAN_DAYS = { weekly: 7, biweekly: 14, monthly: 30 } as const;
export type PaymentPlan = keyof typeof PAYMENT_PLAN_DAYS;
const PAYMENT_PLANS = Object.keys(PAYMENT_PLAN_DAYS) as PaymentPlan[];

export const PROVIDERS = ["sarin", "deepseek"] as const;
export type TranslationProvider = (typeof PROVIDERS)[number];

/** Topes duros de lo que puede fijar el propietario. 0 significa 0 (sin acceso), nunca «ilimitado». */
export const ADMIN_CAPS = {
  maxRequests: 100_000,
  maxChars: 10_000_000,
  maxDays: 400,
  maxPriceMinor: 100_000_000,
  maxInstructionsChars: 1000,
  maxUsersPage: 50,
  defaultUsersPage: 25,
  /** Mercados (países) del catálogo de pagos. */
  maxMarkets: 20,
} as const;

const DAY_MS = 86_400_000;
const UID = /^[A-Za-z0-9._-]{1,128}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** Código de país de dos letras mayúsculas (el que elige el usuario o configura el propietario). */
export function isCountry(value: unknown): value is string {
  return typeof value === "string" && COUNTRY.test(value);
}

/** Cuota del PERIODO de la suscripción (de la activación o renovación al vencimiento). */
export interface SubscriptionLimits {
  readonly maxRequests: number;
  readonly maxChars: number;
}

export interface SubscriptionView {
  readonly status: SubscriptionViewStatus;
  readonly plan: SubscriptionPlan | null;
  readonly expiresAt: number | null;
  readonly limits: SubscriptionLimits | null;
  /** Uso dentro del periodo actual. */
  readonly usage: { readonly requests: number; readonly chars: number };
}

export interface PaymentPlanOffer {
  readonly plan: PaymentPlan;
  readonly days: number;
  readonly amountMinor: number;
  /** Cuota del periodo que da el plan al aprobarse. */
  readonly limits: SubscriptionLimits;
}

/** Oferta pública de un país: su moneda, sus instrucciones de transferencia y sus planes. */
export interface PublicMarket {
  readonly country: string;
  readonly currency: string;
  readonly instructions: string;
  readonly plans: readonly PaymentPlanOffer[];
}

export interface PublicPayments {
  readonly enabled: boolean;
  readonly markets: readonly PublicMarket[];
}

export interface MeResponse {
  readonly uid: string;
  /** Lo decide solo el backend. */
  readonly role: Role;
  readonly subscription: SubscriptionView;
  readonly payments: PublicPayments;
}

export interface SubscriptionUpdate {
  readonly status: SubscriptionStatus;
  readonly plan: SubscriptionPlan;
  readonly expiresAt: number;
  readonly limits: SubscriptionLimits;
}

export interface TranslationSettings {
  readonly activeProvider: TranslationProvider;
  readonly externalProvidersEnabled: boolean;
}

/**
 * Tarifa de un país. Importes en unidad menor de SU moneda (enteros; el exponente lo da ISO 4217); `null` = sin precio.
 * `planLimits`: cuota del periodo que da cada plan al aprobarse una solicitud; `null` = sin configurar.
 */
export interface PaymentMarket {
  readonly country: string;
  readonly currency: string;
  readonly instructions: string;
  readonly prices: Readonly<Record<PaymentPlan, number | null>>;
  readonly planLimits: Readonly<Record<PaymentPlan, SubscriptionLimits | null>>;
}

/**
 * Catálogo de pagos por país, sin tarifa global ni país por defecto. Nada se inventa: activar pagos exige al menos un
 * país y que TODOS estén completos.
 */
export interface PaymentSettings {
  readonly enabled: boolean;
  readonly markets: readonly PaymentMarket[];
}

export interface AdminSettings {
  readonly translation: TranslationSettings;
  readonly payments: PaymentSettings;
}

export interface SettingsUpdate {
  readonly translation?: TranslationSettings;
  readonly payments?: PaymentSettings;
}

export interface AdminUser {
  readonly uid: string;
  readonly email: string | null;
  readonly createdAt: number;
  readonly subscription: SubscriptionView;
}

export interface AdminUsersPage {
  readonly users: readonly AdminUser[];
  readonly nextCursor: string | null;
}

export const PROVIDER_STATES = ["not_configured", "unverified", "verified"] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

/**
 * Estado de un proveedor SIN hacer ninguna petición. `configured` = hay configuración completa. `verified` es
 * HISTÓRICO: alguna vez devolvió una respuesta válida a una petición real de usuario («Respuesta válida registrada»);
 * no es salud actual ni mide calidad. `unverified` = «Sin prueba registrada». Nunca hay sondeos automáticos.
 */
export interface ProviderStatus {
  readonly configured: boolean;
  readonly state: ProviderState;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
}

export interface AdminStatus {
  readonly activeProvider: TranslationProvider;
  readonly providers: Readonly<Record<TranslationProvider, ProviderStatus>>;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = { activeProvider: "sarin", externalProvidersEnabled: false };
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = { enabled: false, markets: [] };

function fail(code: ErrorCode, detail: string): ParseResult<never> {
  return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(input).every((key) => keys.includes(key));
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}

export function isUid(value: unknown): value is string {
  return typeof value === "string" && UID.test(value);
}

// ---------------------------------------------------------------------------------------------------------- Entradas

/** Cuerpo de `PUT /v1/admin/users/:uid/subscription`. Vencimiento futuro y ≤ 400 días; límites con topes duros. */
export function parseSubscriptionUpdate(input: unknown, now: number): ParseResult<SubscriptionUpdate> {
  if (!isRecord(input) || !onlyKeys(input, ["status", "plan", "expiresAt", "limits"])) {
    return fail("INVALID_REQUEST", "suscripción con forma inválida");
  }
  const { status, plan, expiresAt, limits } = input;
  if (!oneOf(SUBSCRIPTION_STATUSES, status)) return fail("INVALID_REQUEST", "estado inválido");
  if (!oneOf(SUBSCRIPTION_PLANS, plan)) return fail("INVALID_REQUEST", "plan inválido");
  if (!isTimestamp(expiresAt) || expiresAt <= now || expiresAt > now + ADMIN_CAPS.maxDays * DAY_MS) {
    return fail("INVALID_REQUEST", "vencimiento inválido");
  }
  if (!isRecord(limits) || !onlyKeys(limits, ["maxRequests", "maxChars"])) return fail("INVALID_REQUEST", "límites inválidos");
  const { maxRequests, maxChars } = limits;
  if (!isCount(maxRequests, ADMIN_CAPS.maxRequests) || !isCount(maxChars, ADMIN_CAPS.maxChars)) {
    return fail("INVALID_REQUEST", "límites fuera de rango");
  }
  return { ok: true, value: { status, plan, expiresAt, limits: { maxRequests, maxChars } } };
}

export function parseTranslationSettings(input: unknown): ParseResult<TranslationSettings> {
  if (!isRecord(input) || !onlyKeys(input, ["activeProvider", "externalProvidersEnabled"])) {
    return fail("INVALID_REQUEST", "ajustes de traducción inválidos");
  }
  const { activeProvider, externalProvidersEnabled } = input;
  if (!oneOf(PROVIDERS, activeProvider) || typeof externalProvidersEnabled !== "boolean") {
    return fail("INVALID_REQUEST", "ajustes de traducción inválidos");
  }
  // DeepSeek es externo: solo puede estar activo con los externos habilitados por el propietario.
  if (activeProvider === "deepseek" && !externalProvidersEnabled) return fail("INVALID_REQUEST", "proveedor externo deshabilitado");
  return { ok: true, value: { activeProvider, externalProvidersEnabled } };
}

/** Límites de un plan: ambos enteros positivos dentro de los topes (0 no tiene sentido para un plan de pago). */
function parsePlanLimit(value: unknown): SubscriptionLimits | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !onlyKeys(value, ["maxRequests", "maxChars"])) return undefined;
  const { maxRequests, maxChars } = value;
  if (!isCount(maxRequests, ADMIN_CAPS.maxRequests) || !isCount(maxChars, ADMIN_CAPS.maxChars)) return undefined;
  if (maxRequests === 0 || maxChars === 0) return undefined;
  return { maxRequests, maxChars };
}

/** Tarifa de un país; moneda vacía o importes/cuotas `null` solo valen como borrador (con pagos apagados). */
function parseMarket(input: unknown): PaymentMarket | undefined {
  if (!isRecord(input) || !onlyKeys(input, ["country", "currency", "instructions", "prices", "planLimits"])) return undefined;
  const { country, currency, instructions, prices, planLimits: rawLimits } = input;
  if (!isCountry(country) || typeof currency !== "string" || typeof instructions !== "string") return undefined;
  if (currency !== "" && !isSupportedCurrency(currency)) return undefined;
  if (instructions.length > ADMIN_CAPS.maxInstructionsChars) return undefined;
  if (!isRecord(prices) || !onlyKeys(prices, PAYMENT_PLANS) || !isRecord(rawLimits) || !onlyKeys(rawLimits, PAYMENT_PLANS)) return undefined;
  const parsedPrices: Record<PaymentPlan, number | null> = { weekly: null, biweekly: null, monthly: null };
  const planLimits: Record<PaymentPlan, SubscriptionLimits | null> = { weekly: null, biweekly: null, monthly: null };
  for (const plan of PAYMENT_PLANS) {
    const price = prices[plan];
    if (price !== undefined && price !== null) {
      if (!isCount(price, ADMIN_CAPS.maxPriceMinor) || price === 0) return undefined;
      parsedPrices[plan] = price;
    }
    const limit = parsePlanLimit(rawLimits[plan]);
    if (limit === undefined) return undefined;
    planLimits[plan] = limit;
  }
  return { country, currency, instructions, prices: parsedPrices, planLimits };
}

/** Moneda, instrucciones y los tres precios y cuotas: lo mínimo para ofrecer el país. */
function marketComplete(market: PaymentMarket): boolean {
  return (
    market.currency !== "" &&
    market.instructions.trim() !== "" &&
    PAYMENT_PLANS.every((plan) => market.prices[plan] !== null && market.planLimits[plan] !== null)
  );
}

export function parsePaymentSettings(input: unknown): ParseResult<PaymentSettings> {
  // Solo la forma por país: la tarifa global antigua no es válida y nunca se asigna a un país.
  if (!isRecord(input) || !onlyKeys(input, ["enabled", "markets"])) return fail("INVALID_REQUEST", "ajustes de pago inválidos");
  const { enabled, markets } = input;
  if (typeof enabled !== "boolean" || !Array.isArray(markets) || markets.length > ADMIN_CAPS.maxMarkets) {
    return fail("INVALID_REQUEST", "ajustes de pago inválidos");
  }
  const parsed: PaymentMarket[] = [];
  const countries = new Set<string>();
  for (const item of markets as unknown[]) {
    const market = parseMarket(item);
    if (!market || countries.has(market.country)) return fail("INVALID_REQUEST", "país inválido o repetido");
    countries.add(market.country);
    parsed.push(market);
  }
  // Activar pagos exige al menos un país y todos completos: nunca con datos vacíos o inventados.
  if (enabled && (parsed.length === 0 || !parsed.every(marketComplete))) return fail("INVALID_REQUEST", "faltan datos de pago");
  return { ok: true, value: { enabled, markets: parsed } };
}

/** Cuerpo de `PUT /v1/admin/settings`: `translation`, `payments` o ambos. */
export function parseSettingsUpdate(input: unknown): ParseResult<SettingsUpdate> {
  if (!isRecord(input) || !onlyKeys(input, ["translation", "payments"]) || Object.keys(input).length === 0) {
    return fail("INVALID_REQUEST", "ajustes con forma inválida");
  }
  let translation: TranslationSettings | undefined;
  let payments: PaymentSettings | undefined;
  if (input.translation !== undefined) {
    const parsed = parseTranslationSettings(input.translation);
    if (!parsed.ok) return parsed;
    translation = parsed.value;
  }
  if (input.payments !== undefined) {
    const parsed = parsePaymentSettings(input.payments);
    if (!parsed.ok) return parsed;
    payments = parsed.value;
  }
  return { ok: true, value: { ...(translation ? { translation } : {}), ...(payments ? { payments } : {}) } };
}

/** Lo que el público ve de los pagos: por país, y nada si están desactivados. */
export function publicPayments(settings: PaymentSettings): PublicPayments {
  if (!settings.enabled) return { enabled: false, markets: [] };
  const markets = settings.markets.filter(marketComplete).map((market): PublicMarket => {
    const plans: PaymentPlanOffer[] = [];
    for (const plan of PAYMENT_PLANS) {
      const amountMinor = market.prices[plan];
      const limits = market.planLimits[plan];
      if (amountMinor !== null && limits !== null) plans.push({ plan, days: PAYMENT_PLAN_DAYS[plan], amountMinor, limits });
    }
    return { country: market.country, currency: market.currency, instructions: market.instructions, plans };
  });
  return { enabled: true, markets };
}

/** El mercado completo de un país, si los pagos están activos y existe; nunca otro país como sustituto. */
export function marketFor(settings: PaymentSettings, country: string): PaymentMarket | undefined {
  if (!settings.enabled) return undefined;
  const market = settings.markets.find((candidate) => candidate.country === country);
  return market && marketComplete(market) ? market : undefined;
}

// -------------------------------------------------------------------------------------------------------- Respuestas

/** `null`, un valor válido, o `undefined` si no es ninguna de las dos cosas. */
function nullable<T>(value: unknown, valid: (candidate: unknown) => candidate is T): T | null | undefined {
  if (value === null) return null;
  return valid(value) ? value : undefined;
}

const VIEW_STATUSES = ["active", "suspended", "inactive", "expired"] as const;

function parseSubscriptionView(input: unknown): SubscriptionView | undefined {
  if (!isRecord(input)) return undefined;
  const { status, limits, usage } = input;
  if (!oneOf(VIEW_STATUSES, status)) return undefined;
  const plan = nullable(input.plan, (value): value is SubscriptionPlan => oneOf(SUBSCRIPTION_PLANS, value));
  const expiresAt = nullable(input.expiresAt, isTimestamp);
  if (plan === undefined || expiresAt === undefined) return undefined;
  let parsedLimits: SubscriptionLimits | null = null;
  if (limits !== null) {
    if (!isRecord(limits)) return undefined;
    const { maxRequests, maxChars } = limits;
    if (!isCount(maxRequests, ADMIN_CAPS.maxRequests) || !isCount(maxChars, ADMIN_CAPS.maxChars)) return undefined;
    parsedLimits = { maxRequests, maxChars };
  }
  if (!isRecord(usage) || !isCount(usage.requests, Number.MAX_SAFE_INTEGER) || !isCount(usage.chars, Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return { status, plan, expiresAt, limits: parsedLimits, usage: { requests: usage.requests, chars: usage.chars } };
}

function parsePublicMarket(input: unknown): PublicMarket | undefined {
  if (!isRecord(input)) return undefined;
  const { country, currency, instructions, plans } = input;
  if (!isCountry(country) || !isSupportedCurrency(currency) || typeof instructions !== "string") return undefined;
  if (instructions.length > ADMIN_CAPS.maxInstructionsChars || !Array.isArray(plans) || plans.length > PAYMENT_PLANS.length) {
    return undefined;
  }
  const offers: PaymentPlanOffer[] = [];
  for (const offer of plans as unknown[]) {
    if (!isRecord(offer) || !oneOf(PAYMENT_PLANS, offer.plan) || offers.some((seen) => seen.plan === offer.plan)) return undefined;
    const days = PAYMENT_PLAN_DAYS[offer.plan];
    const limits = parsePlanLimit(offer.limits);
    if (offer.days !== days || !isCount(offer.amountMinor, ADMIN_CAPS.maxPriceMinor) || offer.amountMinor === 0 || !limits) return undefined;
    offers.push({ plan: offer.plan, days, amountMinor: offer.amountMinor, limits });
  }
  return { country, currency, instructions, plans: offers };
}

function parsePublicPayments(input: unknown): PublicPayments | undefined {
  if (!isRecord(input)) return undefined;
  const { enabled, markets } = input;
  if (typeof enabled !== "boolean" || !Array.isArray(markets) || markets.length > ADMIN_CAPS.maxMarkets) return undefined;
  const parsed: PublicMarket[] = [];
  for (const item of markets as unknown[]) {
    const market = parsePublicMarket(item);
    if (!market || parsed.some((seen) => seen.country === market.country)) return undefined;
    parsed.push(market);
  }
  return { enabled, markets: parsed };
}

export function parseMeResponse(input: unknown): ParseResult<MeResponse> {
  if (!isRecord(input)) return fail("INVALID_RESPONSE", "cuenta con forma inválida");
  const { uid, role } = input;
  if (!isUid(uid) || !oneOf(ROLES, role)) return fail("INVALID_RESPONSE", "cuenta inválida");
  const subscription = parseSubscriptionView(input.subscription);
  const payments = parsePublicPayments(input.payments);
  if (!subscription || !payments) return fail("INVALID_RESPONSE", "cuenta inválida");
  return { ok: true, value: { uid, role, subscription, payments } };
}

export function parseAdminUsersPage(input: unknown): ParseResult<AdminUsersPage> {
  if (!isRecord(input) || !Array.isArray(input.users) || input.users.length > ADMIN_CAPS.maxUsersPage) {
    return fail("INVALID_RESPONSE", "usuarios con forma inválida");
  }
  const nextCursor = nullable(input.nextCursor, isUid);
  if (nextCursor === undefined) return fail("INVALID_RESPONSE", "cursor inválido");
  const isEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 320;
  const users: AdminUser[] = [];
  for (const user of input.users as unknown[]) {
    if (!isRecord(user)) return fail("INVALID_RESPONSE", "usuario inválido");
    const { uid, createdAt } = user;
    const email = nullable(user.email, isEmail);
    const subscription = parseSubscriptionView(user.subscription);
    if (!isUid(uid) || !isTimestamp(createdAt) || email === undefined || !subscription) {
      return fail("INVALID_RESPONSE", "usuario inválido");
    }
    users.push({ uid, email, createdAt, subscription });
  }
  return { ok: true, value: { users, nextCursor } };
}

export function parseAdminSettings(input: unknown): ParseResult<AdminSettings> {
  if (!isRecord(input)) return fail("INVALID_RESPONSE", "ajustes con forma inválida");
  const translation = parseTranslationSettings(input.translation);
  const payments = parsePaymentSettings(input.payments);
  if (!translation.ok || !payments.ok) return fail("INVALID_RESPONSE", "ajustes inválidos");
  return { ok: true, value: { translation: translation.value, payments: payments.value } };
}

function parseProviderStatus(input: unknown): ProviderStatus | undefined {
  if (!isRecord(input)) return undefined;
  const { configured, state } = input;
  const lastSuccessAt = nullable(input.lastSuccessAt, isTimestamp);
  // `lastFailureAt` es aditivo: una respuesta sin él se lee como «sin fallo registrado».
  const lastFailureAt = nullable(input.lastFailureAt ?? null, isTimestamp);
  if (typeof configured !== "boolean" || !oneOf(PROVIDER_STATES, state) || lastSuccessAt === undefined || lastFailureAt === undefined) {
    return undefined;
  }
  return { configured, state, lastSuccessAt, lastFailureAt };
}

export function parseAdminStatus(input: unknown): ParseResult<AdminStatus> {
  if (!isRecord(input) || !oneOf(PROVIDERS, input.activeProvider) || !isRecord(input.providers)) {
    return fail("INVALID_RESPONSE", "estado con forma inválida");
  }
  const sarin = parseProviderStatus(input.providers.sarin);
  const deepseek = parseProviderStatus(input.providers.deepseek);
  if (!sarin || !deepseek) return fail("INVALID_RESPONSE", "estado inválido");
  return { ok: true, value: { activeProvider: input.activeProvider, providers: { sarin, deepseek } } };
}

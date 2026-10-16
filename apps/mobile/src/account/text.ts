import {
  currencyMinorDigits,
  type ErrorCode,
  type PaymentPlan,
  type PaymentRequestStatus,
  type ProviderState,
  type SubscriptionPlan,
  type SubscriptionViewStatus,
} from "@dialon/contracts";

// Textos y formatos de los paneles de cuenta (solo español, como la pantalla de inicio). Nunca se muestra un código
// crudo del servidor ni un mensaje remoto.

const ERRORS: Readonly<Partial<Record<ErrorCode, string>>> = {
  UNAUTHENTICATED: "Tu sesión no es válida. Cierra sesión y vuelve a entrar.",
  TOKEN_EXPIRED: "Tu sesión caducó. Vuelve a cargar la página.",
  FORBIDDEN: "No tienes permiso para esta sección.",
  RATE_LIMITED: "Demasiadas peticiones. Espera un momento y vuelve a intentarlo.",
  CONFLICT: "No se pudo: la solicitud ya cambió de estado. Actualiza la lista.",
  PAYMENTS_DISABLED: "Las solicitudes de suscripción no están disponibles ahora.",
  RECEIPT_EXPIRED: "El comprobante ya no está disponible: tras la revisión se conserva hasta 90 días desde su subida.",
  INVALID_REQUEST: "Revisa los datos: hay algún valor no válido.",
  SERVICE_UNAVAILABLE: "El servicio no está disponible. Vuelve a intentarlo más tarde.",
  TIMEOUT: "El servicio tardó demasiado. Vuelve a intentarlo.",
  NETWORK: "Sin conexión con el servicio. Revisa tu red y vuelve a intentarlo.",
  INVALID_RESPONSE: "Respuesta inesperada del servicio. Vuelve a intentarlo.",
};

export function errorText(code: ErrorCode): string {
  return ERRORS[code] ?? "No se pudo completar. Vuelve a intentarlo.";
}

export const PLAN_LABEL: Readonly<Record<SubscriptionPlan, string>> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  custom: "Personalizado",
};

export const PAYMENT_PLANS: readonly PaymentPlan[] = ["weekly", "biweekly", "monthly"];

export const SUBSCRIPTION_LABEL: Readonly<Record<SubscriptionViewStatus, string>> = {
  active: "Activa",
  suspended: "Suspendida",
  inactive: "Inactiva",
  expired: "Vencida",
};

export const REQUEST_LABEL: Readonly<Record<PaymentRequestStatus, string>> = {
  pending: "Pendiente de revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
};

/** El estado es HISTÓRICO: qué pasó con peticiones reales, no la salud actual. */
export const PROVIDER_LABEL: Readonly<Record<ProviderState, string>> = {
  verified: "Respuesta válida registrada",
  unverified: "Sin prueba registrada",
  not_configured: "Sin configurar",
};

export const RECEIPT_RULES =
  "PDF, PNG o JPG de 5 MiB como máximo. El comprobante es privado: solo lo veis tú y el propietario. Se conserva mientras la solicitud está en revisión; una vez aprobada o rechazada, deja de estar disponible a los 90 días de subirlo.";

/** Estado del comprobante sin prometer borrados: pendiente se conserva; resuelto, disponible hasta su fecha. */
export function receiptState(receipt: { readonly available: boolean; readonly expiresAt: number }, status: PaymentRequestStatus): string {
  if (!receipt.available) return "ya no disponible";
  return status === "pending" ? "se conserva mientras la solicitud esté en revisión" : `disponible hasta el ${formatDate(receipt.expiresAt)}`;
}

const LOCALE = "es-ES";

export function formatDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
}

export function formatCount(value: number): string {
  return value.toLocaleString(LOCALE);
}

/**
 * Importe en unidad menor con el CÓDIGO de su moneda («50.000,00 COP», «5,00 GBP»): nunca un símbolo ambiguo. El
 * exponente está fijado por ISO 4217 (nunca se supone 2); si la moneda no se conoce, el número tal cual. Sin conversión.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = currencyMinorDigits(currency);
  if (digits !== undefined) {
    try {
      const format = new Intl.NumberFormat(LOCALE, { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: digits, maximumFractionDigits: digits });
      // Espacios de no separación → espacio normal: el texto se lee y se busca igual en todos los motores.
      return format.format(amountMinor / 10 ** digits).replace(/[\u00a0\u202f]/g, " ");
    } catch {
      // Sigue abajo.
    }
  }
  return `${formatCount(amountMinor)} (unidad menor) ${currency}`;
}

type RegionNames = new (locales: string[], options: { type: "region" }) => { of(code: string): string | undefined };

/** «Colombia (CO)»; sin nombre disponible, el código. `null` → historial sin país. */
export function countryLabel(country: string | null): string {
  if (country === null) return "Sin país registrado";
  let name: string | undefined;
  try {
    const DisplayNames = (Intl as { DisplayNames?: RegionNames }).DisplayNames;
    name = DisplayNames ? new DisplayNames([LOCALE], { type: "region" }).of(country) : undefined;
  } catch {
    name = undefined;
  }
  return name && name !== country ? `${name} (${country})` : country;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${formatCount(Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`;
}

export const DAY_MS = 86_400_000;

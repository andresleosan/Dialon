// Moneda y país sin suposiciones: unidades menores ISO 4217 explícitas, Intl solo para mostrar; sin
// conversión de divisas. El país solo se SUGIERE desde una región explícita de los idiomas del dispositivo.

/** Tope de importe en unidad menor (igual que `ADMIN_CAPS.maxPriceMinor`; aquí para no crear un ciclo de módulos). */
const MAX_PRICE_MINOR = 100_000_000;

// ISO 4217/SIX List One, publicado 2026-09-17. Fuente y hash: docs/verification/2026-10-16-currency-units.md.
const ISO_MINOR_UNITS: Readonly<Record<string, number>> = {
  "AED": 2,
  "AFN": 2,
  "ALL": 2,
  "AMD": 2,
  "AOA": 2,
  "ARS": 2,
  "AUD": 2,
  "AWG": 2,
  "AZN": 2,
  "BAM": 2,
  "BBD": 2,
  "BDT": 2,
  "BHD": 3,
  "BIF": 0,
  "BMD": 2,
  "BND": 2,
  "BOB": 2,
  "BOV": 2,
  "BRL": 2,
  "BSD": 2,
  "BTN": 2,
  "BWP": 2,
  "BYN": 2,
  "BZD": 2,
  "CAD": 2,
  "CDF": 2,
  "CHE": 2,
  "CHF": 2,
  "CHW": 2,
  "CLF": 4,
  "CLP": 0,
  "CNY": 2,
  "COP": 2,
  "COU": 2,
  "CRC": 2,
  "CUP": 2,
  "CVE": 2,
  "CZK": 2,
  "DJF": 0,
  "DKK": 2,
  "DOP": 2,
  "DZD": 2,
  "EGP": 2,
  "ERN": 2,
  "ETB": 2,
  "EUR": 2,
  "FJD": 2,
  "FKP": 2,
  "GBP": 2,
  "GEL": 2,
  "GHS": 2,
  "GIP": 2,
  "GMD": 2,
  "GNF": 0,
  "GTQ": 2,
  "GYD": 2,
  "HKD": 2,
  "HNL": 2,
  "HTG": 2,
  "HUF": 2,
  "IDR": 2,
  "ILS": 2,
  "INR": 2,
  "IQD": 3,
  "IRR": 2,
  "ISK": 0,
  "JMD": 2,
  "JOD": 3,
  "JPY": 0,
  "KES": 2,
  "KGS": 2,
  "KHR": 2,
  "KMF": 0,
  "KPW": 2,
  "KRW": 0,
  "KWD": 3,
  "KYD": 2,
  "KZT": 2,
  "LAK": 2,
  "LBP": 2,
  "LKR": 2,
  "LRD": 2,
  "LSL": 2,
  "LYD": 3,
  "MAD": 2,
  "MDL": 2,
  "MGA": 2,
  "MKD": 2,
  "MMK": 2,
  "MNT": 2,
  "MOP": 2,
  "MRU": 2,
  "MUR": 2,
  "MVR": 2,
  "MWK": 2,
  "MXN": 2,
  "MXV": 2,
  "MYR": 2,
  "MZN": 2,
  "NAD": 2,
  "NGN": 2,
  "NIO": 2,
  "NOK": 2,
  "NPR": 2,
  "NZD": 2,
  "OMR": 3,
  "PAB": 2,
  "PEN": 2,
  "PGK": 2,
  "PHP": 2,
  "PKR": 2,
  "PLN": 2,
  "PYG": 0,
  "QAR": 2,
  "RON": 2,
  "RSD": 2,
  "RUB": 2,
  "RWF": 0,
  "SAR": 2,
  "SBD": 2,
  "SCR": 2,
  "SDG": 2,
  "SEK": 2,
  "SGD": 2,
  "SHP": 2,
  "SLE": 2,
  "SOS": 2,
  "SRD": 2,
  "SSP": 2,
  "STN": 2,
  "SVC": 2,
  "SYP": 2,
  "SZL": 2,
  "THB": 2,
  "TJS": 2,
  "TMT": 2,
  "TND": 3,
  "TOP": 2,
  "TRY": 2,
  "TTD": 2,
  "TWD": 2,
  "TZS": 2,
  "UAH": 2,
  "UGX": 0,
  "USD": 2,
  "USN": 2,
  "UYI": 0,
  "UYU": 2,
  "UYW": 4,
  "UZS": 2,
  "VED": 2,
  "VES": 2,
  "VND": 0,
  "VUV": 0,
  "WST": 2,
  "XAD": 2,
  "XAF": 0,
  "XCD": 2,
  "XCG": 2,
  "XOF": 0,
  "XPF": 0,
  "YER": 2,
  "ZAR": 2,
  "ZMW": 2,
  "ZWG": 2
};

const CODE = /^[A-Z]{3}$/;
const MAJOR = /^(\d+)(?:\.(\d+))?$/;

let supported: ReadonlySet<string> | undefined;

/** Código ISO 4217 en mayúsculas que este motor de Intl conoce. Sin `Intl.supportedValuesOf`, ninguno. */
export function isSupportedCurrency(currency: unknown): currency is string {
  if (typeof currency !== "string" || !CODE.test(currency)) return false;
  if (supported === undefined) {
    try {
      supported = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      supported = new Set();
    }
  }
  return supported.has(currency) && ISO_MINOR_UNITS[currency] !== undefined;
}

/** Decimales ISO de la unidad menor (COP/GBP 2, JPY 0, KWD 3); `undefined` si la moneda no se conoce. */
export function currencyMinorDigits(currency: string): number | undefined {
  return isSupportedCurrency(currency) ? ISO_MINOR_UNITS[currency] : undefined;
}

/**
 * Importe escrito en unidad mayor («12.50», sin separadores de miles, punto decimal) → entero en unidad menor de esa
 * moneda, entre 1 y el tope. Exacto (sin coma flotante); más decimales de los que tiene la moneda → `undefined`.
 */
export function parseMajorToMinor(text: string, currency: string): number | undefined {
  const digits = currencyMinorDigits(currency);
  const match = MAJOR.exec(text);
  if (digits === undefined || !match) return undefined;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return undefined;
  const minorText = `${whole}${fraction.padEnd(digits, "0")}`.replace(/^0+(?=\d)/, "");
  if (minorText.length > 15) return undefined;
  const minor = Number(minorText);
  return Number.isSafeInteger(minor) && minor >= 1 && minor <= MAX_PRICE_MINOR ? minor : undefined;
}

/** Inverso exacto para editar: 5000000 COP → «50000.00»; 1500 JPY → «1500». Sin agrupar miles. */
export function minorToMajorText(amountMinor: number, currency: string): string | undefined {
  const digits = currencyMinorDigits(currency);
  if (digits === undefined || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return undefined;
  if (digits === 0) return String(amountMinor);
  const text = String(amountMinor).padStart(digits + 1, "0");
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * Primera región EXPLÍCITA de dos letras en los idiomas dados («es-CO» → CO, «en-GB» → GB). Un idioma sin región
 * («es», «en»), una región numérica («es-419») o una etiqueta inválida no dan país: nunca se completa con maximize().
 */
export function countryFromLocales(locales: readonly string[]): string | undefined {
  // Algunos motores (p. ej. nativos) no tienen Intl.Locale: entonces no hay sugerencia.
  const Locale = (Intl as { Locale?: typeof Intl.Locale }).Locale;
  if (Locale === undefined) return undefined;
  for (const tag of locales) {
    try {
      const region = new Locale(tag).region;
      if (region !== undefined && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      // Etiqueta inválida: se ignora.
    }
  }
  return undefined;
}

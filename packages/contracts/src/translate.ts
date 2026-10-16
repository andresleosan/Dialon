import type { ErrorCode } from "./errors";
import { createLimits, type Limits } from "./limits";
import { parseTurnMeta, type LanguageCode, type ParseResult } from "./parse";

/** Traducción de texto a texto (sin audio ni ASR). */
export interface TextTranslationRequest {
  readonly requestId: string;
  readonly source: LanguageCode;
  readonly target: LanguageCode;
  readonly text: string;
  /**
   * Consentimiento explícito para que el texto se procese en un proveedor externo (p. ej. DeepSeek). No elige
   * proveedor: eso lo decide solo el propietario en el servidor.
   */
  readonly externalProcessingConsent?: boolean;
}

export const TEXT_TIMING_PHASES = ["auth", "translate", "total"] as const;
export type TextTimingPhase = (typeof TEXT_TIMING_PHASES)[number];

/** Dónde se procesó el texto: en el servidor del propietario (Sarin) o en un proveedor externo (DeepSeek). */
export const TEXT_PROCESSING = { sarin: "owner_hosted", deepseek: "external" } as const;
export type TextProvider = keyof typeof TEXT_PROCESSING;
export type TextProcessing = (typeof TEXT_PROCESSING)[TextProvider];

export interface TextTranslationResult {
  readonly requestId: string;
  readonly translation: string;
  /** Siempre del servidor real: la demo nunca produce este resultado. */
  readonly mode: "real";
  readonly timingsMs?: Partial<Record<TextTimingPhase, number>>;
  /** Transparencia: proveedor que respondió (el elegido por el propietario; nunca hay fallback). */
  readonly provider?: TextProvider;
  readonly processing?: TextProcessing;
}

/**
 * Catálogo compartido por el parser, el Worker y el cliente. Aceptar un idioma no acredita que el modelo lo traduzca
 * bien: ninguno está validado contra Sarin todavía. `DEFAULT_LIMITS` (es/en) no cambia.
 */
export const DEFAULT_TEXT_TRANSLATION_LIMITS: Limits = createLimits({ languages: ["es", "en", "pt", "fr", "de", "it"] });

const REQUEST_KEYS: ReadonlySet<string> = new Set(["requestId", "source", "target", "text", "externalProcessingConsent"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// `detail` nunca repite el valor recibido: puede acabar en registros y no debe llevar contenido del usuario.
function fail(code: ErrorCode, detail: string): ParseResult<never> {
  return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, limits: Limits): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= limits.maxTextChars;
}

/** Petición estricta: cualquier propiedad ajena (`uid`, `url`, `model`, `messages`…) se rechaza. */
export function parseTextTranslationRequest(
  input: unknown,
  limits: Limits = DEFAULT_TEXT_TRANSLATION_LIMITS,
): ParseResult<TextTranslationRequest> {
  if (!isRecord(input)) return fail("INVALID_REQUEST", "la petición debe ser un objeto");
  if (Object.keys(input).some((key) => !REQUEST_KEYS.has(key))) {
    return fail("INVALID_REQUEST", "propiedad no admitida");
  }
  const meta = parseTurnMeta(input, limits);
  if (!meta.ok) return meta;
  if (!isText(input.text, limits)) return fail("INVALID_REQUEST", "texto vacío o demasiado largo");
  const consent = input.externalProcessingConsent;
  if (consent === undefined) return { ok: true, value: { ...meta.value, text: input.text } };
  if (typeof consent !== "boolean") return fail("INVALID_REQUEST", "consentimiento inválido");
  return { ok: true, value: { ...meta.value, text: input.text, externalProcessingConsent: consent } };
}

/** Resultado del servidor. Proyecta solo los campos y tiempos conocidos. */
export function parseTextTranslationResult(
  input: unknown,
  limits: Limits = DEFAULT_TEXT_TRANSLATION_LIMITS,
): ParseResult<TextTranslationResult> {
  if (!isRecord(input)) return fail("INVALID_RESPONSE", "el resultado debe ser un objeto");
  const { requestId, translation, mode, timingsMs, provider, processing } = input;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return fail("INVALID_RESPONSE", "requestId inválido");
  if (!isText(translation, limits)) return fail("INVALID_RESPONSE", "traducción inválida");
  if (mode !== "real") return fail("INVALID_RESPONSE", "modo inválido");
  // Metadatos opcionales (respuestas antiguas no los traen); si vienen, deben ser coherentes entre sí.
  let origin: { provider: TextProvider; processing: TextProcessing } | undefined;
  if (provider !== undefined || processing !== undefined) {
    if (provider !== "sarin" && provider !== "deepseek") return fail("INVALID_RESPONSE", "proveedor inválido");
    if (processing !== TEXT_PROCESSING[provider]) return fail("INVALID_RESPONSE", "procesamiento inválido");
    origin = { provider, processing: TEXT_PROCESSING[provider] };
  }
  const value = { requestId: requestId.toLowerCase(), translation, mode, ...origin } as const;
  if (timingsMs === undefined) return { ok: true, value };
  if (!isRecord(timingsMs)) return fail("INVALID_RESPONSE", "tiempos con forma inválida");
  const timings: Partial<Record<TextTimingPhase, number>> = {};
  for (const phase of TEXT_TIMING_PHASES) {
    const ms = timingsMs[phase];
    if (ms === undefined) continue;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return fail("INVALID_RESPONSE", "tiempo inválido");
    timings[phase] = ms;
  }
  return { ok: true, value: { ...value, timingsMs: timings } };
}

/** Metadatos de transparencia de un proveedor. */
export function textOrigin(provider: TextProvider): { provider: TextProvider; processing: TextProcessing } {
  return { provider, processing: TEXT_PROCESSING[provider] };
}

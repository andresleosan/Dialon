import { isServerErrorCode, type ErrorCode, type ServerErrorCode } from "./errors";
import { DEFAULT_LIMITS, LANGUAGE_CODE, type Limits } from "./limits";

/** Código de idioma ISO 639 en minúsculas, p. ej. "es". */
export type LanguageCode = string;
export type InferenceMode = "real" | "demo";

export interface TurnMeta {
  readonly requestId: string;
  readonly source: LanguageCode;
  readonly target: LanguageCode;
}

export const TIMING_PHASES = ["auth", "asr", "translate", "total"] as const;
export type TimingPhase = (typeof TIMING_PHASES)[number];

export interface TurnResult {
  readonly requestId: string;
  readonly transcript: string;
  readonly translation: string;
  readonly mode: InferenceMode;
  readonly timingsMs?: Partial<Record<TimingPhase, number>>;
}

export interface ApiError {
  readonly code: ServerErrorCode;
  readonly message: string;
  readonly requestId?: string;
}

export interface AudioInfo {
  readonly mimeType: string;
  readonly byteLength: number;
  readonly durationMs?: number;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// `detail` nunca repite el valor recibido: puede acabar en registros y no debe llevar contenido del usuario.
function fail(code: ErrorCode, detail: string): ParseResult<never> {
  return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isText(value: unknown, limits: Limits): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= limits.maxTextChars;
}

/** Metadatos que envía el cliente. Devuelve solo los campos conocidos: un `uid` del cliente se descarta. */
export function parseTurnMeta(input: unknown, limits: Limits = DEFAULT_LIMITS): ParseResult<TurnMeta> {
  if (!isRecord(input)) return fail("INVALID_REQUEST", "los metadatos deben ser un objeto");
  const { requestId, source, target } = input;
  if (!isUuid(requestId)) return fail("INVALID_REQUEST", "requestId debe ser un UUID");
  if (typeof source !== "string" || typeof target !== "string" || !LANGUAGE_CODE.test(source) || !LANGUAGE_CODE.test(target)) {
    return fail("INVALID_REQUEST", "source y target deben ser códigos ISO 639 en minúsculas");
  }
  if (!limits.languages.includes(source) || !limits.languages.includes(target)) {
    return fail("UNSUPPORTED_LANGUAGE", "idioma no ofrecido");
  }
  if (source === target) return fail("UNSUPPORTED_LANGUAGE", "origen y destino deben ser distintos");
  return { ok: true, value: { requestId: requestId.toLowerCase(), source, target } };
}

/**
 * Audio grabado, recibido desde cualquier frontera JS: lo que no sea un objeto devuelve INVALID_AUDIO, no lanza.
 * Sin `durationMs` (el servidor aún no la conoce) solo se comprueban tipo y tamaño.
 */
export function validateAudio(input: unknown, limits: Limits = DEFAULT_LIMITS): ParseResult<AudioInfo> {
  if (!isRecord(input)) return fail("INVALID_AUDIO", "los datos de audio deben ser un objeto");
  const { mimeType, byteLength, durationMs } = input;
  const baseType = typeof mimeType === "string" ? mimeType.split(";")[0]?.trim().toLowerCase() : undefined;
  if (baseType === undefined || !limits.audioTypes.includes(baseType)) {
    return fail("INVALID_AUDIO", "tipo de audio no admitido");
  }
  if (typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength <= 0) {
    return fail("INVALID_AUDIO", "audio vacío o tamaño inválido");
  }
  if (byteLength > limits.maxAudioBytes) return fail("AUDIO_TOO_LARGE", "audio demasiado grande");
  if (durationMs === undefined) return { ok: true, value: { mimeType: baseType, byteLength } };
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return fail("INVALID_AUDIO", "duración inválida");
  }
  if (durationMs < limits.minAudioMs) return fail("TOO_SHORT", "grabación demasiado corta");
  if (durationMs > limits.maxAudioMs) return fail("AUDIO_TOO_LONG", "grabación demasiado larga");
  return { ok: true, value: { mimeType: baseType, byteLength, durationMs } };
}

/** Respuesta correcta del servidor. Descarta campos y tiempos desconocidos. */
export function parseTurnResult(input: unknown, limits: Limits = DEFAULT_LIMITS): ParseResult<TurnResult> {
  if (!isRecord(input)) return fail("INVALID_RESPONSE", "el resultado debe ser un objeto");
  const { requestId, transcript, translation, mode, timingsMs } = input;
  if (!isUuid(requestId)) return fail("INVALID_RESPONSE", "requestId inválido");
  if (!isText(transcript, limits) || !isText(translation, limits)) {
    return fail("INVALID_RESPONSE", "transcripción o traducción inválida");
  }
  if (mode !== "real" && mode !== "demo") return fail("INVALID_RESPONSE", "modo desconocido");

  let timings: Partial<Record<TimingPhase, number>> | undefined;
  if (timingsMs !== undefined) {
    if (!isRecord(timingsMs)) return fail("INVALID_RESPONSE", "tiempos con forma inválida");
    timings = {};
    for (const phase of TIMING_PHASES) {
      const ms = timingsMs[phase];
      if (ms === undefined) continue;
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
        return fail("INVALID_RESPONSE", "tiempo inválido");
      }
      timings[phase] = ms;
    }
  }
  return {
    ok: true,
    value: { requestId: requestId.toLowerCase(), transcript, translation, mode, timingsMs: timings },
  };
}

/** Error del servidor. Solo admite códigos de servidor: los del cliente no pueden llegar por red. */
export function parseApiError(input: unknown, limits: Limits = DEFAULT_LIMITS): ParseResult<ApiError> {
  if (!isRecord(input) || !isRecord(input.error)) return fail("INVALID_RESPONSE", "error con forma inesperada");
  const { code, message } = input.error;
  const { requestId } = input;
  if (!isServerErrorCode(code)) return fail("INVALID_RESPONSE", "código de error desconocido");
  if (typeof message !== "string" || message.length > limits.maxTextChars) {
    return fail("INVALID_RESPONSE", "mensaje de error inválido");
  }
  if (requestId !== undefined && !isUuid(requestId)) return fail("INVALID_RESPONSE", "requestId inválido");
  return { ok: true, value: { code, message, requestId: requestId?.toLowerCase() } };
}

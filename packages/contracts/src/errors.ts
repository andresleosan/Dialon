/** Códigos estables que puede devolver el servidor (Worker o gateway). */
export const SERVER_ERROR_CODES = [
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "INVALID_REQUEST",
  "INVALID_AUDIO",
  "AUDIO_TOO_LARGE",
  "AUDIO_TOO_LONG",
  "TOO_SHORT",
  "UNSUPPORTED_LANGUAGE",
  "NO_SPEECH",
  "BUSY",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
  "INTERNAL",
] as const;

/** Códigos que solo genera el cliente: micrófono, red, respuesta inválida y voz del dispositivo. */
export const CLIENT_ERROR_CODES = [
  "MIC_PERMISSION_DENIED",
  "RECORDER_FAILED",
  "NETWORK",
  "INVALID_RESPONSE",
  "VOICE_UNAVAILABLE",
  "PLAYBACK_INTERRUPTED",
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type ErrorCode = ServerErrorCode | ClientErrorCode;

export function isServerErrorCode(value: unknown): value is ServerErrorCode {
  return SERVER_ERROR_CODES.some((code) => code === value);
}

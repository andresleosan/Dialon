import type { ServerErrorCode } from "@dialon/contracts";

// Respuestas JSON del Worker: `no-store`, `nosniff`, CORS del origen permitido y mensajes de error FIJOS (nunca texto,
// token, uid, email, secreto ni nada del upstream). Una línea de log por respuesta de error, sin datos personales.

const MESSAGES: Readonly<Partial<Record<ServerErrorCode, string>>> = {
  UNAUTHENTICATED: "Authentication required.",
  TOKEN_EXPIRED: "Session expired.",
  FORBIDDEN: "Forbidden.",
  RATE_LIMITED: "Too many requests.",
  INVALID_REQUEST: "Invalid request.",
  UNSUPPORTED_LANGUAGE: "Unsupported language.",
  BUSY: "Translator busy.",
  SERVICE_UNAVAILABLE: "Service unavailable.",
  TIMEOUT: "Timed out.",
  INTERNAL: "Internal error.",
  SUBSCRIPTION_REQUIRED: "Active subscription required.",
  QUOTA_EXCEEDED: "Subscription period quota exhausted.",
  CONSENT_REQUIRED: "External processing consent required.",
};

export interface Context {
  readonly cors: Headers;
  readonly started: number;
  readonly log: (line: string) => void;
  /** Ruta lógica para el log (`translate`, `me`, `admin`), nunca la URL completa. */
  readonly event: string;
}

export function baseHeaders(cors: Headers): Headers {
  const headers = new Headers(cors);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export function respond(context: Context, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  const headers = baseHeaders(context.cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

export function fail(
  context: Context,
  status: number,
  code: ServerErrorCode,
  { requestId, upstreamStatus, extra }: { requestId?: string; upstreamStatus?: number; extra?: Record<string, string> } = {},
): Response {
  context.log(JSON.stringify({ event: context.event, status, code, requestId, upstreamStatus, ms: Date.now() - context.started }));
  const error = { code, message: MESSAGES[code] ?? "Error." };
  return respond(context, status, requestId === undefined ? { error } : { error, requestId }, extra);
}

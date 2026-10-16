import type { ServerErrorCode } from "@dialon/contracts";
import { BodyError, parseJson, readBoundedText } from "./http";

/** Tope por defecto; los ajustes del propietario (catálogo de hasta 20 países) usan `SETTINGS_BODY_BYTES`. */
const MAX_BODY_BYTES = 16 * 1024;
export const SETTINGS_BODY_BYTES = 128 * 1024;

export type BodyOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number; readonly code: ServerErrorCode };

/** Cuerpo JSON acotado (16 KiB por defecto; también sin Content-Length) y bajo el plazo de la petición. */
export async function readJson(request: Request, signal: AbortSignal, maxBytes = MAX_BODY_BYTES): Promise<BodyOutcome> {
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") ?? "")) {
    return { ok: false, status: 415, code: "INVALID_REQUEST" };
  }
  if (Number(request.headers.get("Content-Length") ?? "0") > maxBytes) return { ok: false, status: 413, code: "INVALID_REQUEST" };
  try {
    return { ok: true, value: parseJson(await readBoundedText(request.body, maxBytes, signal)) };
  } catch (error) {
    if (error instanceof BodyError) return { ok: false, status: error.reason === "too-large" ? 413 : 400, code: "INVALID_REQUEST" };
    return { ok: false, status: 504, code: "TIMEOUT" };
  }
}

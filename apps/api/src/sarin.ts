import { postChatCompletion, translationPrompt, type ChatOutcome, type Fetch } from "./chat";

// IA Sarin: endpoint y modelo FIJOS en el servidor. Nada de la petición del cliente llega a la URL, al modelo, a los
// parámetros ni a las cabeceras. Solo traducción de texto (stream:false), sin ASR. Estado comprobado por Root: DNS y TLS
// responden y un OPTIONS sin credenciales recibe 403 de Cloudflare Access. NO están verificados el modelo, las
// credenciales de servicio ni la forma real de la respuesta.

export const SARIN_ENDPOINT = "https://ia-sarin.alsdevstudio.com/v1/chat/completions";
export const SARIN_MODEL = "qwen3.8:27b-q4_K_M";

const MAX_TOKENS = 1024;

/** Credenciales de servicio de Cloudflare Access (opcionales), solo del Worker. */
export interface AccessCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export type SarinAuth =
  | { readonly mode: "unconfigured" }
  | { readonly mode: "none"; readonly access?: AccessCredentials }
  | { readonly mode: "bearer"; readonly key: string; readonly access?: AccessCredentials };

export type SarinOutcome = ChatOutcome;

/** Variable opcional del entorno del Worker (var o secreto), sin declarar un `Env` paralelo. */
export function optionalString(env: object, name: string): string | undefined {
  if (!(name in env)) return undefined;
  const value: unknown = (env as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** Valor de Access: string no vacío tras `trim`, o `undefined` si el campo existe pero no vale. */
function accessField(env: object, name: string): string | undefined {
  const value = optionalString(env, name)?.trim();
  return value ? value : undefined;
}

/**
 * Autenticación del upstream. Por defecto SIN CONFIGURAR (falla cerrado). Solo `none` o `bearer` con clave, puestos de
 * forma explícita; nunca hay inferencia anónima por omisión. El par de Cloudflare Access es opcional: si NO existe
 * ninguno de los dos campos, no se usa; si existe CUALQUIERA (aunque sea vacío, en blanco o no string), ambos deben ser
 * strings no vacíos, o Sarin queda sin configurar.
 */
export function sarinAuthFrom(env: object): SarinAuth {
  const anyAccess = "SARIN_ACCESS_CLIENT_ID" in env || "SARIN_ACCESS_CLIENT_SECRET" in env;
  let access: AccessCredentials | undefined;
  if (anyAccess) {
    const clientId = accessField(env, "SARIN_ACCESS_CLIENT_ID");
    const clientSecret = accessField(env, "SARIN_ACCESS_CLIENT_SECRET");
    if (clientId === undefined || clientSecret === undefined) return { mode: "unconfigured" };
    access = { clientId, clientSecret };
  }

  const mode = optionalString(env, "SARIN_AUTH_MODE");
  if (mode === "none") return access ? { mode: "none", access } : { mode: "none" };
  const key = optionalString(env, "SARIN_API_KEY")?.trim();
  if (mode === "bearer" && key) return access ? { mode: "bearer", key, access } : { mode: "bearer", key };
  return { mode: "unconfigured" };
}

/** Una sola llamada (sin reintentos: cada intento puede costar inferencia). `signal` lleva el plazo del Worker. */
export async function translateWithSarin(
  input: { readonly text: string; readonly source: string; readonly target: string; readonly maxChars: number },
  auth: SarinAuth,
  fetchFn: Fetch,
  signal: AbortSignal,
): Promise<SarinOutcome> {
  if (auth.mode === "unconfigured") return { ok: false, code: "SERVICE_UNAVAILABLE" };
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json" });
  if (auth.mode === "bearer") headers.set("Authorization", `Bearer ${auth.key}`);
  if (auth.access) {
    headers.set("CF-Access-Client-Id", auth.access.clientId);
    headers.set("CF-Access-Client-Secret", auth.access.clientSecret);
  }
  const body = JSON.stringify({
    model: SARIN_MODEL,
    stream: false,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: translationPrompt(input.source, input.target) },
      { role: "user", content: input.text },
    ],
  });
  return postChatCompletion({ url: SARIN_ENDPOINT, headers, body, maxChars: input.maxChars }, fetchFn, signal);
}

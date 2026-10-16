import { postChatCompletion, translationPrompt, type ChatOutcome, type Fetch } from "./chat";
import { optionalString } from "./sarin";

// DeepSeek: proveedor EXTERNO. URL fija; modelo solo de una lista cerrada; sin razonamiento (`thinking` desactivado) y
// sin streaming. La clave `DEEPSEEK_API_KEY` es un secreto del Worker: nunca llega al cliente, a la respuesta ni a logs.
// Solo se usa si el propietario lo activa con los externos habilitados y la petición trae consentimiento explícito.

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];

const MAX_TOKENS = 1024;

export interface DeepSeekConfig {
  readonly key: string;
  readonly model: DeepSeekModel;
}

/** Configuración completa o `undefined` (sin clave, o modelo fuera de la lista): falla cerrado. */
export function deepseekConfigFrom(env: object): DeepSeekConfig | undefined {
  const key = optionalString(env, "DEEPSEEK_API_KEY")?.trim();
  const model = optionalString(env, "DEEPSEEK_MODEL")?.trim();
  const allowed = DEEPSEEK_MODELS.find((candidate) => candidate === model);
  return key && allowed ? { key, model: allowed } : undefined;
}

export function translateWithDeepSeek(
  input: { readonly text: string; readonly source: string; readonly target: string; readonly maxChars: number },
  config: DeepSeekConfig,
  fetchFn: Fetch,
  signal: AbortSignal,
): Promise<ChatOutcome> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${config.key}`,
  });
  const body = JSON.stringify({
    model: config.model,
    stream: false,
    thinking: { type: "disabled" },
    temperature: 0,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: translationPrompt(input.source, input.target) },
      { role: "user", content: input.text },
    ],
  });
  return postChatCompletion({ url: DEEPSEEK_ENDPOINT, headers, body, maxChars: input.maxChars }, fetchFn, signal);
}

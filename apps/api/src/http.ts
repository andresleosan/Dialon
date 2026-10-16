/** Cuerpo demasiado grande o ilegible: nunca lleva contenido del usuario en el mensaje. */
export class BodyError extends Error {
  constructor(readonly reason: "too-large" | "unreadable") {
    super(reason);
  }
}

/** La petición se canceló o agotó su plazo mientras esperaba (D1, R2, limitador…). Se responde 504. */
export class AbortedError extends Error {
  constructor() {
    super("aborted");
  }
}

/**
 * Espera una operación respetando la señal: la comprueba ANTES de empezar (si ya se canceló, la operación ni se
 * inicia) y deja de esperar en cuanto se cancela. D1/R2 no son cancelables por debajo: la operación ya iniciada puede
 * terminar sola, pero la petición no queda colgada y ningún paso posterior se ejecuta. Su rechazo tardío se absorbe.
 */
export function guarded<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  let operation: Promise<T>;
  try {
    operation = start();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("fallo"));
  }
  operation.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new AbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // Si `start` canceló la señal de forma síncrona, el evento ya pasó: sin esto se esperaría para siempre.
    if (signal.aborted) onAbort();
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(new AbortedError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? new AbortedError() : error instanceof Error ? error : new Error("fallo"));
      },
    );
  });
}

/**
 * Trabajo informativo con presupuesto pequeño: nunca retrasa la respuesta más de `budgetMs` ni pasa del plazo de la
 * petición, y su fallo se absorbe sin dejar rechazos sin manejar.
 */
export async function bestEffort(signal: AbortSignal, budgetMs: number, start: () => Promise<unknown>): Promise<void> {
  try {
    await guarded(AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]), start);
  } catch {
    // Informativo: su fallo o su lentitud no cambian la respuesta.
  }
}

/**
 * Lee un cuerpo sin pasar de `maxBytes`, aunque no haya `Content-Length`. Si la señal se cancela, suelta el stream y
 * rechaza: ninguna espera queda colgada.
 */
export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array(0);
  signal.throwIfAborted();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error("cancelado"));
      },
      { once: true },
    );
  });
  aborted.catch(() => undefined);
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyError("too-large");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Igual que `readBoundedBytes`, decodificado como UTF-8 estricto. */
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const bytes = await readBoundedBytes(body, maxBytes, signal);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new BodyError("unreadable");
  }
}

/** JSON sin lanzar: `undefined` si no es JSON válido. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

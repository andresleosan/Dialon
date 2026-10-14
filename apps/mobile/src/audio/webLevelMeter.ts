// Unas 20 lecturas por segundo: suficiente para ver la voz sin repintar en cada cuadro.
const INTERVAL_MS = 50;
const FFT_SIZE = 1024;

/** Lo que se usa del navegador; puede faltar (navegador sin Web Audio). */
interface BrowserAudio {
  readonly AudioContext?: typeof AudioContext;
  readonly requestAnimationFrame?: typeof requestAnimationFrame;
  readonly cancelAnimationFrame?: typeof cancelAnimationFrame;
}

/** Un paso de limpieza que falla (nodo ya desconectado, contexto ya cerrado…) no impide los siguientes. */
function attempt(step: () => void) {
  try {
    step();
  } catch {
    // Nada más que soltar en este paso.
  }
}

/** Intensidad RMS de muestras en el dominio del tiempo, acotada a 0..1. Un resultado no finito cuenta como 0. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  return Number.isFinite(rms) ? Math.min(1, rms) : 0;
}

/**
 * Mide la intensidad real del micrófono ya abierto (el mismo stream que graba): un AnalyserNode que nunca se conecta
 * a los altavoces, así que no se oye nada. Llama a `onLevel` con el RMS medido ~20 veces por segundo y con `null` si
 * la medición no está disponible o deja de funcionar. Nunca lanza: si algo falla, solo se apaga el medidor y la
 * grabación sigue. Devuelve la función que lo suelta todo (cuadro pendiente, nodos y contexto); repetirla no hace nada.
 */
export function startLevelMeter(stream: MediaStream, onLevel: (level: number | null) => void): () => void {
  const browser = globalThis as BrowserAudio;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let frame: number | undefined;
  let stopped = false;

  // Cada recurso se suelta por separado: si uno falla, los demás se sueltan igual.
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const pending = frame;
    frame = undefined;
    if (pending !== undefined) {
      attempt(() => {
        browser.cancelAnimationFrame?.(pending);
      });
    }
    attempt(() => {
      source?.disconnect();
    });
    attempt(() => {
      analyser?.disconnect();
    });
    attempt(() => {
      void context?.close().catch(() => undefined);
    });
  };
  // Apaga el medidor y avisa una sola vez; un oyente que lanza no saca el error de aquí ni rompe la grabación.
  const fail = () => {
    if (stopped) return;
    stop();
    attempt(() => {
      onLevel(null);
    });
  };

  if (!browser.AudioContext || !browser.requestAnimationFrame) {
    fail();
    return stop;
  }
  try {
    context = new browser.AudioContext();
    source = context.createMediaStreamSource(stream);
    const reader = context.createAnalyser();
    analyser = reader;
    reader.fftSize = FFT_SIZE;
    source.connect(reader);
    const samples = new Float32Array(reader.fftSize);
    const running = context;
    let last = -Infinity;
    const tick = (time: number) => {
      if (stopped) return;
      frame = browser.requestAnimationFrame?.(tick);
      // Mientras el contexto no suena, el analizador solo daría ceros: no se muestra un silencio inventado.
      if (time - last < INTERVAL_MS || running.state !== "running") return;
      last = time;
      try {
        reader.getFloatTimeDomainData(samples);
        onLevel(rmsLevel(samples));
      } catch {
        // Falle la lectura o el oyente, el medidor se apaga sin que el error salga del cuadro de animación.
        fail();
      }
    };
    frame = browser.requestAnimationFrame(tick);
    // Algunos navegadores crean el contexto suspendido. Reanudar no retrasa la grabación; si falla, solo se apaga el
    // medidor, y si llega tarde tras detener, ya no hay nada que revivir.
    if (context.state === "suspended") context.resume().catch(fail);
  } catch {
    fail();
  }
  return stop;
}

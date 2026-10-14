import { DEFAULT_LIMITS, validateAudio, type ErrorCode, type ParseResult } from "@dialon/contracts";
import type { AudioCapture, AudioClip, Recording } from "./capture";

// Preferencia: Opus en WebM (Chrome, Firefox, Edge) y AAC en MP4 (Safari). Solo tipos que admite el contrato.
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/webm", "audio/mp4"];
// Trozos periódicos: el tamaño se vigila mientras se graba, no solo al final.
const SLICE_MS = 1000;
// Se detiene antes del máximo para que la duración medida nunca lo supere.
const LIMIT_MARGIN_MS = 500;
// Tras detener, el navegador entrega el último trozo enseguida; si no llega en este tiempo, la grabación falló.
const FINALIZE_TIMEOUT_MS = 3000;

/** Lo que se usa del navegador; puede faltar entero (navegador antiguo o contexto sin HTTPS). */
interface BrowserMedia {
  readonly MediaRecorder?: typeof MediaRecorder;
  readonly navigator?: { readonly mediaDevices?: Partial<MediaDevices> };
}

function failure(code: ErrorCode, detail: string): ParseResult<never> {
  return { ok: false, code, detail };
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

/** Motivo de una cancelación, siempre como Error (`AbortError`). */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Grabación cancelada", "AbortError");
}

// Función y no `signal.aborted` en línea: la señal puede cancelarse durante cualquier espera.
function isAborted(signal: AbortSignal) {
  return signal.aborted;
}

function isDenied(error: unknown) {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "SecurityError");
}

/** Espera el permiso sin bloquear la cancelación: un micrófono concedido tarde se apaga al instante. */
function requestMicrophone(getUserMedia: MediaDevices["getUserMedia"], signal: AbortSignal) {
  return new Promise<MediaStream>((resolve, reject) => {
    // Se pide antes de escuchar la señal: si getUserMedia lanza en el acto, no queda ninguna escucha colgada.
    const request = getUserMedia({ audio: true });
    const onAbort = () => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(
      (stream) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) stopTracks(stream);
        else resolve(stream);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("micrófono no disponible"));
      },
    );
  });
}

function record(recorder: MediaRecorder, stream: MediaStream, mimeType: string, signal: AbortSignal): Recording {
  const startedAt = performance.now();
  const chunks: Blob[] = [];
  let bytes = 0;
  let stoppedAt: number | undefined;
  let settled = false;
  let finalizeTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (outcome: ParseResult<AudioClip>) => void;
  let rejectResult!: (reason: Error) => void;
  const result = new Promise<ParseResult<AudioClip>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const limitTimer = setTimeout(stop, DEFAULT_LIMITS.maxAudioMs - LIMIT_MARGIN_MS);

  /** Suelta todo lo que posee la grabación: escuchas, temporizadores, micrófono, grabador y trozos. */
  function release() {
    settled = true;
    clearTimeout(limitTimer);
    clearTimeout(finalizeTimer);
    signal.removeEventListener("abort", onAbort);
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    stopTracks(stream);
    if (recorder.state !== "inactive") recorder.stop();
    chunks.length = 0;
  }

  function finish(outcome: ParseResult<AudioClip>) {
    if (settled) return;
    release();
    resolveResult(outcome);
  }

  function onAbort() {
    if (settled) return;
    release();
    rejectResult(abortReason(signal));
  }

  function stop() {
    if (settled || stoppedAt !== undefined) return;
    stoppedAt = performance.now();
    clearTimeout(limitTimer);
    if (recorder.state !== "inactive") recorder.stop();
    // El micrófono se apaga ya; el navegador conserva lo grabado para el último trozo.
    stopTracks(stream);
    finalizeTimer = setTimeout(() => {
      finish(failure("RECORDER_FAILED", "la grabación no terminó a tiempo"));
    }, FINALIZE_TIMEOUT_MS);
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    chunks.push(event.data);
    bytes += event.data.size;
    if (bytes > DEFAULT_LIMITS.maxAudioBytes) finish(failure("AUDIO_TOO_LARGE", "audio demasiado grande"));
  };
  recorder.onstop = () => {
    if (stoppedAt === undefined) {
      finish(failure("RECORDER_FAILED", "la grabación se detuvo sola"));
      return;
    }
    const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
    const durationMs = stoppedAt - startedAt;
    const checked = validateAudio({ mimeType: audio.type, byteLength: audio.size, durationMs });
    finish(checked.ok ? { ok: true, value: { audio, info: { ...checked.value, durationMs } } } : checked);
  };
  recorder.onerror = () => {
    finish(failure("RECORDER_FAILED", "error del grabador"));
  };
  for (const track of stream.getTracks()) {
    track.onended = () => {
      finish(failure("RECORDER_FAILED", "el micrófono se cerró"));
    };
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return { stop, result };
}

/** Grabación local en el navegador con getUserMedia + MediaRecorder. Nada sale del dispositivo. */
export const webAudioCapture: AudioCapture = {
  async start(signal) {
    if (isAborted(signal)) throw abortReason(signal);
    const { MediaRecorder: Recorder, navigator } = globalThis as BrowserMedia;
    const devices = navigator?.mediaDevices;
    const getUserMedia = devices?.getUserMedia?.bind(devices);
    const mimeType = Recorder && MIME_TYPES.find((type) => Recorder.isTypeSupported(type));
    if (!Recorder || mimeType === undefined || !getUserMedia) {
      return failure("RECORDER_FAILED", "este navegador no puede grabar audio");
    }

    let stream: MediaStream;
    try {
      stream = await requestMicrophone(getUserMedia, signal);
    } catch (error) {
      if (isAborted(signal)) throw abortReason(signal);
      return failure(isDenied(error) ? "MIC_PERMISSION_DENIED" : "RECORDER_FAILED", "micrófono no disponible");
    }
    if (isAborted(signal)) {
      stopTracks(stream);
      throw abortReason(signal);
    }

    let recorder: MediaRecorder;
    try {
      recorder = new Recorder(stream, { mimeType });
      recorder.start(SLICE_MS);
    } catch {
      stopTracks(stream);
      return failure("RECORDER_FAILED", "no se pudo iniciar la grabación");
    }
    return { ok: true, value: record(recorder, stream, mimeType, signal) };
  },
};

import { DEFAULT_LIMITS, parseTurnMeta, parseTurnResult, validateAudio } from "@dialon/contracts";
import {
  initialConversation,
  reduceConversation,
  type ConversationEvent,
  type Participant,
  type Turn,
} from "@dialon/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { AudioClip, LocalAudio, Recording } from "./audio/capture";
import { isUiLanguage, type Language, type PairIssue, type UiLanguage } from "./copy";

// Retardos del simulador DEMO. No representan latencias reales del pipeline.
const DEMO_TIMINGS = {
  prepareMs: 300,
  finalizeMs: 200,
  translateMs: 1200,
  speakMs: 2500,
  stopSpeechMs: 200,
  // Se detiene antes del máximo para que la duración nunca lo supere.
  limitMarginMs: 500,
} as const;

// ponytail: tamaño simulado de un m4a (cabecera + 128 kbps) solo para pasar por las validaciones reales.
const DEMO_HEADER_BYTES = 1024;
const DEMO_BYTES_PER_MS = 16;

const DEMO_PHRASES: Readonly<Record<UiLanguage, { transcript: string; translation: string }>> = {
  es: { transcript: "Hola, ¿cómo estás?", translation: "Hello, how are you?" },
  en: { transcript: "Nice to meet you.", translation: "Encantado de conocerte." },
};

type Languages = Readonly<Record<Participant, Language>>;

/** El único clip local: de quién es y su audio. Se descarta al empezar otro turno o cambiar de idioma. */
export interface LocalClip extends AudioClip {
  readonly participant: Participant;
}

export type Playback = "idle" | "playing" | "failed";

/** Grabación de un turno: su señal y, cuando empieza, su sesión. Cada turno tiene la suya. */
interface CaptureOwner {
  readonly controller: AbortController;
  recording?: Recording;
  /** Pasa a `false` con el segundo toque: desde entonces ningún nivel tardío se pinta. */
  metering: boolean;
}

/** Niveles recientes que se dibujan como barras (unos 1,6 s a ~20 lecturas por segundo). */
const LEVEL_HISTORY = 32;

function otherParticipant(participant: Participant): Participant {
  return participant === "A" ? "B" : "A";
}

/** Por qué el par no puede hablar en la DEMO: el mismo idioma en las dos personas o uno sin ejemplos DEMO. */
function pairIssueOf(languages: Languages): PairIssue | undefined {
  if (languages.A === languages.B) return "same";
  return isUiLanguage(languages.A) && isUiLanguage(languages.B) ? undefined : "pending";
}

/** Resultado DEMO marcado como simulado y validado con el mismo contrato que usará el servidor. */
function demoResultEvent(turn: Turn): ConversationEvent {
  const phrase = isUiLanguage(turn.source) ? DEMO_PHRASES[turn.source] : undefined;
  const result = parseTurnResult({
    requestId: turn.requestId,
    transcript: phrase && `[DEMO] ${phrase.transcript}`,
    translation: phrase && `[DEMO] ${phrase.translation}`,
    mode: "demo",
  });
  return result.ok
    ? { type: "RESULT", result: result.value }
    : { type: "FAILED", requestId: turn.requestId, code: result.code };
}

/**
 * Controlador de la conversación sobre el reductor real.
 *
 * Sin `audio` (nativo) es exclusivamente DEMO: sin micrófono, voz, red ni servicios. Simula cada paso con
 * temporizadores; cada estado programa como mucho un paso y lo cancela al cambiar de estado o al desmontar; además,
 * los eventos llevan el `requestId` del turno, así que uno antiguo nunca afecta a otro.
 *
 * Con `audio` (web) graba de verdad y guarda un único clip local para reproducirlo a mano. No hay traducción: no se
 * inventa ningún resultado y la simulación no corre. Cancelar, cambiar de turno, pasar a segundo plano o desmontar
 * cancelan la señal de la grabación y de la reproducción.
 */
export function useDemoConversation(createRequestId: () => string, audio?: LocalAudio) {
  const [state, dispatch] = useReducer(reduceConversation, initialConversation);
  const [languages, setLanguages] = useState<Languages>({ A: "es", B: "en" });
  const [clip, setClip] = useState<LocalClip>();
  const [playback, setPlayback] = useState<Playback>("idle");
  // Intensidad real del micrófono de la grabación activa; vacía si no hay grabación o no hay medición.
  const [levels, setLevels] = useState<readonly number[]>([]);
  const pairIssue = pairIssueOf(languages);
  const recordingStartedAt = useRef(0);
  const capture = useRef<CaptureOwner>(undefined);
  const playing = useRef<AbortController>(undefined);
  // Turno grabado en curso: el reductor conserva el mismo objeto `turn` desde PREPARING hasta PROCESSING.
  const captureTurn = audio && state.status !== "IDLE" && state.status !== "SPEAKING" ? state.turn : undefined;

  useEffect(() => {
    if (audio) return undefined;
    const after = (ms: number, event: () => ConversationEvent) => {
      const timer = setTimeout(() => {
        dispatch(event());
      }, ms);
      return () => {
        clearTimeout(timer);
      };
    };

    switch (state.status) {
      case "IDLE":
        return undefined;
      case "PREPARING": {
        const { requestId } = state.turn;
        return after(DEMO_TIMINGS.prepareMs, () => ({ type: "RECORDING_STARTED", requestId, at: Date.now() }));
      }
      case "RECORDING_A":
      case "RECORDING_B": {
        recordingStartedAt.current = state.startedAt;
        const { requestId } = state.turn;
        const limitMs = DEFAULT_LIMITS.maxAudioMs - DEMO_TIMINGS.limitMarginMs;
        return after(limitMs, () => ({ type: "TIME_LIMIT", requestId }));
      }
      case "PROCESSING": {
        const { turn } = state;
        if (state.phase === "waiting_server") return after(DEMO_TIMINGS.translateMs, () => demoResultEvent(turn));
        const durationMs = Date.now() - recordingStartedAt.current;
        const audio = validateAudio({
          mimeType: "audio/mp4",
          byteLength: DEMO_HEADER_BYTES + durationMs * DEMO_BYTES_PER_MS,
          durationMs,
        });
        return after(DEMO_TIMINGS.finalizeMs, () =>
          audio.ok
            ? { type: "AUDIO_READY", requestId: turn.requestId }
            : { type: "FAILED", requestId: turn.requestId, code: audio.code },
        );
      }
      case "SPEAKING": {
        const { requestId } = state.turn;
        return state.stopping
          ? after(DEMO_TIMINGS.stopSpeechMs, () => ({ type: "SPEECH_ENDED", requestId, reason: "stopped" }))
          : after(DEMO_TIMINGS.speakMs, () => ({ type: "SPEECH_ENDED", requestId, reason: "done" }));
      }
    }
  }, [state, audio]);

  useEffect(() => {
    if (!audio || !captureTurn) return undefined;
    const { requestId, participant } = captureTurn;
    const owner: CaptureOwner = { controller: new AbortController(), metering: true };
    capture.current = owner;
    const { signal } = owner.controller;
    // Tras cada espera: si el turno se canceló o cambió, su respuesta ya no toca nada.
    const stale = () => signal.aborted;
    const onLevel = (level: number | null) => {
      if (stale() || !owner.metering) return;
      setLevels((current) => (level === null ? [] : [...current, level].slice(-LEVEL_HISTORY)));
    };
    const run = async () => {
      const started = await audio.capture.start(signal, onLevel);
      if (stale()) return;
      if (!started.ok) {
        dispatch({ type: "FAILED", requestId, code: started.code });
        return;
      }
      owner.recording = started.value;
      dispatch({ type: "RECORDING_STARTED", requestId, at: Date.now() });
      const result = await started.value.result;
      if (stale()) return;
      // Si terminó sola (límite de tiempo o tamaño), primero pasa a finalizar como con el segundo toque.
      dispatch({ type: "TIME_LIMIT", requestId });
      if (!result.ok) {
        dispatch({ type: "FAILED", requestId, code: result.code });
        return;
      }
      setClip({ participant, ...result.value });
      // Sin traducción no hay resultado que mostrar: el turno vuelve a reposo con el clip guardado.
      dispatch({ type: "CANCEL" });
    };
    // Una cancelación rechaza a propósito; cualquier otro rechazo es un fallo del grabador.
    run().catch(() => {
      if (!stale()) dispatch({ type: "FAILED", requestId, code: "RECORDER_FAILED" });
    });
    return () => {
      owner.controller.abort();
      // Solo suelta la referencia si sigue siendo suya: nunca la de un turno más nuevo.
      if (capture.current === owner) capture.current = undefined;
      setLevels([]);
    };
  }, [audio, captureTurn]);

  /** Invalida la grabación en el acto: un permiso o un clip que lleguen en la misma tarea ya no hacen nada. */
  const abortCapture = useCallback(() => {
    capture.current?.controller.abort();
    capture.current = undefined;
    setLevels([]);
  }, []);

  const stopPlayback = useCallback(() => {
    playing.current?.abort();
    playing.current = undefined;
    setPlayback("idle");
  }, []);

  const discardClip = useCallback(() => {
    stopPlayback();
    setClip(undefined);
  }, [stopPlayback]);

  // Nada graba ni suena en segundo plano (en web, pestaña oculta): se cancela el turno y se para el audio. Al salir
  // de la página (pagehide, también hacia la caché de retroceso) además se descarta el clip.
  useEffect(() => {
    if (!audio) return undefined;
    const hide = () => {
      abortCapture();
      dispatch({ type: "CANCEL" });
      stopPlayback();
    };
    const leave = () => {
      hide();
      discardClip();
    };
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") hide();
    });
    const web = Platform.OS === "web";
    if (web) globalThis.addEventListener("pagehide", leave);
    return () => {
      subscription.remove();
      if (web) globalThis.removeEventListener("pagehide", leave);
      stopPlayback();
    };
  }, [audio, abortCapture, stopPlayback, discardClip]);

  /** Reproduce el clip a mano, solo en reposo: nunca se solapa con una grabación. */
  const play = useCallback(() => {
    if (!audio || !clip || state.status !== "IDLE") return;
    playing.current?.abort();
    const controller = new AbortController();
    playing.current = controller;
    setPlayback("playing");
    const settle = (next: Playback) => {
      if (playing.current !== controller) return;
      playing.current = undefined;
      setPlayback(next);
    };
    audio.player.play(clip, controller.signal).then(
      () => {
        settle("idle");
      },
      () => {
        settle("failed");
      },
    );
  }, [audio, clip, state.status]);

  /** Un toque: empieza un turno con UUID nuevo, lo termina o detiene la voz; el reductor decide. */
  const press = useCallback(
    (participant: Participant) => {
      if (state.status !== "IDLE") {
        const ownRecording = state.status === "RECORDING_A" || state.status === "RECORDING_B";
        const owner = capture.current;
        if (ownRecording && state.turn.participant === participant && owner) {
          owner.metering = false;
          setLevels([]);
          owner.recording?.stop();
        }
        dispatch({ ...state.turn, type: "PRESS", participant });
        return;
      }
      // Par bloqueado: los botones ya están deshabilitados; aquí no se pide UUID ni se inicia nada.
      if (pairIssue !== undefined) return;
      // Un turno nuevo para la reproducción y descarta el clip anterior antes de abrir el micrófono.
      discardClip();
      const meta = parseTurnMeta({
        requestId: createRequestId(),
        source: languages[participant],
        target: languages[otherParticipant(participant)],
      });
      dispatch(meta.ok ? { type: "PRESS", participant, ...meta.value } : { type: "REJECTED", participant, code: meta.code });
    },
    [state, languages, pairIssue, createRequestId, discardClip],
  );

  const cancel = useCallback(() => {
    abortCapture();
    stopPlayback();
    dispatch({ type: "CANCEL" });
  }, [abortCapture, stopPlayback]);

  /**
   * Solo en reposo y si cambia, y solo el de esa persona (sin intercambio): un turno conserva su par y el último
   * resultado sigue visible hasta un cambio real, que lo borra para no mostrarlo bajo idiomas que no son los suyos.
   */
  const selectLanguage = useCallback(
    (participant: Participant, language: Language) => {
      if (state.status !== "IDLE" || languages[participant] === language) return;
      setLanguages((current) => ({ ...current, [participant]: language }));
      dispatch({ type: "RESET" });
      discardClip();
    },
    [state.status, languages, discardClip],
  );

  return { state, languages, pairIssue, press, cancel, selectLanguage, clip, playback, play, stopPlayback, levels };
}

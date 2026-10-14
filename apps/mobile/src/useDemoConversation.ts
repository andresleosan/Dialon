import { DEFAULT_LIMITS, parseTurnMeta, parseTurnResult, validateAudio } from "@dialon/contracts";
import {
  initialConversation,
  reduceConversation,
  type ConversationEvent,
  type Participant,
  type Turn,
} from "@dialon/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
 * Controlador exclusivamente DEMO: sin micrófono, voz, red ni servicios. Simula cada paso con temporizadores
 * sobre el reductor real. Cada estado programa como mucho un paso y lo cancela al cambiar de estado o al
 * desmontar; además, los eventos llevan el `requestId` del turno, así que uno antiguo nunca afecta a otro.
 */
export function useDemoConversation(createRequestId: () => string) {
  const [state, dispatch] = useReducer(reduceConversation, initialConversation);
  const [languages, setLanguages] = useState<Languages>({ A: "es", B: "en" });
  const pairIssue = pairIssueOf(languages);
  const recordingStartedAt = useRef(0);

  useEffect(() => {
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
  }, [state]);

  /** Un toque: empieza un turno con UUID nuevo, lo termina o detiene la voz; el reductor decide. */
  const press = useCallback(
    (participant: Participant) => {
      if (state.status !== "IDLE") {
        dispatch({ ...state.turn, type: "PRESS", participant });
        return;
      }
      // Par bloqueado: los botones ya están deshabilitados; aquí no se pide UUID ni se inicia nada.
      if (pairIssue !== undefined) return;
      const meta = parseTurnMeta({
        requestId: createRequestId(),
        source: languages[participant],
        target: languages[otherParticipant(participant)],
      });
      dispatch(meta.ok ? { type: "PRESS", participant, ...meta.value } : { type: "REJECTED", participant, code: meta.code });
    },
    [state, languages, pairIssue, createRequestId],
  );

  const cancel = useCallback(() => {
    dispatch({ type: "CANCEL" });
  }, []);

  /**
   * Solo en reposo y si cambia, y solo el de esa persona (sin intercambio): un turno conserva su par y el último
   * resultado sigue visible hasta un cambio real, que lo borra para no mostrarlo bajo idiomas que no son los suyos.
   */
  const selectLanguage = useCallback(
    (participant: Participant, language: Language) => {
      if (state.status !== "IDLE" || languages[participant] === language) return;
      setLanguages((current) => ({ ...current, [participant]: language }));
      dispatch({ type: "RESET" });
    },
    [state.status, languages],
  );

  return { state, languages, pairIssue, press, cancel, selectLanguage };
}

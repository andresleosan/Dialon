import type { ErrorCode, TurnMeta, TurnResult } from "@dialon/contracts";

export type Participant = "A" | "B";

/** Turno en curso. Los idiomas son una instantánea tomada al tocar: cambiarlos después no lo altera. */
export interface Turn extends TurnMeta {
  readonly participant: Participant;
}

/** Último turno completado; sigue visible mientras la otra persona responde. */
export interface CompletedTurn {
  readonly participant: Participant;
  readonly result: TurnResult;
}

/** Error recuperable. `participant` indica en qué mitad de la pantalla se muestra el aviso. */
export interface TurnError {
  readonly participant: Participant;
  readonly code: ErrorCode;
}

export type ConversationState = { readonly last?: CompletedTurn } & (
  | { readonly status: "IDLE"; readonly error?: TurnError }
  | { readonly status: "PREPARING"; readonly turn: Turn }
  | { readonly status: "RECORDING_A" | "RECORDING_B"; readonly turn: Turn; readonly startedAt: number }
  | { readonly status: "PROCESSING"; readonly turn: Turn; readonly phase: "finalizing_audio" | "waiting_server" }
  | { readonly status: "SPEAKING"; readonly turn: Turn; readonly result: TurnResult; readonly stopping: boolean }
);

export type SpeechEndReason = "done" | "stopped" | "unavailable" | "error";

export type ConversationEvent =
  | ({ readonly type: "PRESS"; readonly participant: Participant } & TurnMeta)
  | { readonly type: "RECORDING_STARTED"; readonly requestId: string; readonly at: number }
  | { readonly type: "TIME_LIMIT"; readonly requestId: string }
  | { readonly type: "AUDIO_READY"; readonly requestId: string }
  | { readonly type: "RESULT"; readonly result: TurnResult }
  | { readonly type: "FAILED"; readonly requestId: string; readonly code: ErrorCode }
  | { readonly type: "SPEECH_ENDED"; readonly requestId: string; readonly reason: SpeechEndReason }
  /** El controlador no pudo iniciar el turno (p. ej. metadatos inválidos): solo avisa en esa mitad. */
  | { readonly type: "REJECTED"; readonly participant: Participant; readonly code: ErrorCode }
  | { readonly type: "CANCEL" }
  | { readonly type: "RESET" };

export const initialConversation: ConversationState = { status: "IDLE" };

const SPEECH_NOTICE: Record<SpeechEndReason, ErrorCode | undefined> = {
  done: undefined,
  stopped: undefined,
  unavailable: "VOICE_UNAVAILABLE",
  error: "PLAYBACK_INTERRUPTED",
};

function listenerOf(participant: Participant): Participant {
  return participant === "A" ? "B" : "A";
}

function assertNever(state: never): never {
  // Solo el tipo, nunca el contenido: el estado puede llevar texto de la conversación.
  throw new Error(`Estado de conversación no contemplado (${typeof state})`);
}

/**
 * Reductor puro de un turno half-duplex. Un evento que no aplica devuelve el mismo objeto `state`,
 * así que las respuestas tardías o de otro `requestId` no tienen efecto.
 *
 * Precondiciones (las garantiza quien despacha los eventos):
 * - metadatos y resultados ya validados con los contratos de `@dialon/contracts`;
 * - cada `PRESS` que inicia un turno trae un UUID nuevo: reutilizarlo haría coincidir eventos de un turno antiguo.
 *
 * `RESET` solo limpia el estado: no detiene el grabador, la petición ni la voz; esos efectos son del controlador.
 */
export function reduceConversation(state: ConversationState, event: ConversationEvent): ConversationState {
  if (event.type === "RESET") return initialConversation;
  const { last } = state;

  switch (state.status) {
    case "IDLE": {
      if (event.type === "REJECTED") {
        return { status: "IDLE", last, error: { participant: event.participant, code: event.code } };
      }
      if (event.type !== "PRESS") return state;
      const { participant, requestId, source, target } = event;
      if (source === target) {
        return { status: "IDLE", last, error: { participant, code: "UNSUPPORTED_LANGUAGE" } };
      }
      return { status: "PREPARING", last, turn: { participant, requestId, source, target } };
    }

    case "PREPARING": {
      // Mientras se prepara el grabador, cualquier toque (también un doble toque) se ignora.
      const { turn } = state;
      if (event.type === "CANCEL") return { status: "IDLE", last };
      if (event.type === "RECORDING_STARTED" && event.requestId === turn.requestId) {
        const status = turn.participant === "A" ? "RECORDING_A" : "RECORDING_B";
        return { status, last, turn, startedAt: event.at };
      }
      if (event.type === "FAILED" && event.requestId === turn.requestId) {
        return { status: "IDLE", last, error: { participant: turn.participant, code: event.code } };
      }
      return state;
    }

    case "RECORDING_A":
    case "RECORDING_B": {
      const { turn } = state;
      if (event.type === "CANCEL") return { status: "IDLE", last };
      const ownSecondTap = event.type === "PRESS" && event.participant === turn.participant;
      const timeLimit = event.type === "TIME_LIMIT" && event.requestId === turn.requestId;
      if (ownSecondTap || timeLimit) return { status: "PROCESSING", last, turn, phase: "finalizing_audio" };
      if (event.type === "FAILED" && event.requestId === turn.requestId) {
        return { status: "IDLE", last, error: { participant: turn.participant, code: event.code } };
      }
      return state;
    }

    case "PROCESSING": {
      // Ya no hay toques que valgan: el segundo toque solo detiene una vez.
      const { turn } = state;
      if (event.type === "CANCEL") return { status: "IDLE", last };
      if (event.type === "AUDIO_READY" && event.requestId === turn.requestId && state.phase === "finalizing_audio") {
        return { ...state, phase: "waiting_server" };
      }
      // Solo se acepta el resultado tras enviar el audio: uno prematuro durante finalizing_audio se ignora.
      if (event.type === "RESULT" && state.phase === "waiting_server" && event.result.requestId === turn.requestId) {
        const completed = { participant: turn.participant, result: event.result };
        return { status: "SPEAKING", last: completed, turn, result: event.result, stopping: false };
      }
      if (event.type === "FAILED" && event.requestId === turn.requestId) {
        return { status: "IDLE", last, error: { participant: turn.participant, code: event.code } };
      }
      return state;
    }

    case "SPEAKING": {
      // Un toque o cancelar solo detienen la voz; se graba de nuevo cuando la voz confirma que terminó.
      const { turn } = state;
      if (event.type === "PRESS" || event.type === "CANCEL") {
        return state.stopping ? state : { ...state, stopping: true };
      }
      if (event.type === "SPEECH_ENDED" && event.requestId === turn.requestId) {
        const code = SPEECH_NOTICE[event.reason];
        if (code === undefined) return { status: "IDLE", last };
        return { status: "IDLE", last, error: { participant: listenerOf(turn.participant), code } };
      }
      return state;
    }

    default:
      return assertNever(state);
  }
}

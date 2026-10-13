import type { TurnResult } from "@dialon/contracts";
import { describe, expect, it } from "vitest";
import {
  initialConversation,
  reduceConversation,
  type ConversationEvent,
  type ConversationState,
  type Participant,
} from "./conversation";

const ID_A = "6a1f2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d";
const ID_B = "7b2e3d4c-5f6a-4b8c-9d0e-1f2a3b4c5d6e";
const ES_EN = { source: "es", target: "en" };
const EN_ES = { source: "en", target: "es" };

function run(events: readonly ConversationEvent[], from: ConversationState = initialConversation) {
  return events.reduce(reduceConversation, from);
}

function press(participant: Participant, requestId: string, langs = participant === "A" ? ES_EN : EN_ES) {
  return { type: "PRESS", participant, requestId, ...langs } as const;
}

function resultFor(requestId: string): TurnResult {
  return { requestId, transcript: "Hola, ¿cómo estás?", translation: "Hello, how are you?", mode: "demo" };
}

// Los estados de partida se alcanzan a través del propio reductor, no se fabrican a mano.
const preparingA = () => run([press("A", ID_A)]);
const recordingA = () => run([press("A", ID_A), { type: "RECORDING_STARTED", requestId: ID_A, at: 1_000 }]);
const waitingA = () => run([press("A", ID_A), { type: "AUDIO_READY", requestId: ID_A }], recordingA());
const speakingA = () => reduceConversation(waitingA(), { type: "RESULT", result: resultFor(ID_A) });

describe("turnos A↔B con dos toques", () => {
  it("A toca: se prepara el grabador con su turno e idiomas", () => {
    expect(run([press("A", ID_A)])).toEqual({
      status: "PREPARING",
      turn: { participant: "A", requestId: ID_A, source: "es", target: "en" },
    });
  });

  it("con el grabador listo, A pasa a RECORDING_A y B a RECORDING_B", () => {
    expect(recordingA()).toMatchObject({ status: "RECORDING_A", startedAt: 1_000 });
    const recordingB = run([press("B", ID_B), { type: "RECORDING_STARTED", requestId: ID_B, at: 5 }]);
    expect(recordingB).toMatchObject({
      status: "RECORDING_B",
      turn: { participant: "B", source: "en", target: "es" },
    });
  });

  it("B no puede grabar mientras A prepara o graba", () => {
    const preparing = run([press("A", ID_A)]);
    expect(preparing.status).toBe("PREPARING");
    expect(reduceConversation(preparing, press("B", ID_B))).toBe(preparing);

    const recording = recordingA();
    expect(recording.status).toBe("RECORDING_A");
    expect(reduceConversation(recording, press("B", ID_B))).toBe(recording);
  });

  it("un doble toque rápido mientras se prepara no inicia ni detiene nada", () => {
    const preparing = run([press("A", ID_A)]);
    expect(preparing.status).toBe("PREPARING");
    expect(reduceConversation(preparing, press("A", ID_B))).toBe(preparing);
  });

  it("el segundo toque de A termina la grabación una sola vez", () => {
    const processing = reduceConversation(recordingA(), press("A", ID_B));
    expect(processing).toMatchObject({
      status: "PROCESSING",
      phase: "finalizing_audio",
      turn: { requestId: ID_A },
    });
    expect(reduceConversation(processing, press("A", ID_B))).toBe(processing);
    expect(reduceConversation(processing, press("B", ID_B))).toBe(processing);
  });

  it("el límite de tiempo termina la grabación; el de otro turno se ignora", () => {
    const recording = recordingA();
    expect(reduceConversation(recording, { type: "TIME_LIMIT", requestId: ID_B })).toBe(recording);
    expect(reduceConversation(recording, { type: "TIME_LIMIT", requestId: ID_A })).toMatchObject({
      status: "PROCESSING",
      phase: "finalizing_audio",
    });
  });

  it("los idiomas son una instantánea: cambiarlos después no altera el turno", () => {
    const processing = reduceConversation(recordingA(), press("A", ID_B, { source: "fr", target: "de" }));
    expect(processing).toMatchObject({ status: "PROCESSING", turn: { source: "es", target: "en" } });
  });

  it("con el mismo idioma en origen y destino no empieza y avisa en esa mitad", () => {
    expect(run([press("A", ID_A, { source: "es", target: "es" })])).toEqual({
      status: "IDLE",
      error: { participant: "A", code: "UNSUPPORTED_LANGUAGE" },
    });
  });
});

describe("respuestas, cancelación y respuestas tardías", () => {
  it("la respuesta del turno activo se muestra y pasa a SPEAKING", () => {
    const waiting = waitingA();
    expect(waiting).toMatchObject({ status: "PROCESSING", phase: "waiting_server" });
    expect(reduceConversation(waiting, { type: "RESULT", result: resultFor(ID_A) })).toMatchObject({
      status: "SPEAKING",
      stopping: false,
      result: resultFor(ID_A),
      last: { participant: "A", result: resultFor(ID_A) },
    });
  });

  it("un resultado prematuro mientras se finaliza el audio se ignora", () => {
    const finalizing = reduceConversation(recordingA(), press("A", ID_B));
    expect(finalizing).toMatchObject({ status: "PROCESSING", phase: "finalizing_audio" });
    expect(reduceConversation(finalizing, { type: "RESULT", result: resultFor(ID_A) })).toBe(finalizing);
  });

  it("una respuesta o un fallo con otro requestId se ignora", () => {
    const waiting = waitingA();
    expect(waiting.status).toBe("PROCESSING");
    expect(reduceConversation(waiting, { type: "RESULT", result: resultFor(ID_B) })).toBe(waiting);
    expect(reduceConversation(waiting, { type: "FAILED", requestId: ID_B, code: "TIMEOUT" })).toBe(waiting);
  });

  it("tras cancelar, la respuesta tardía del turno cancelado se ignora", () => {
    const waiting = waitingA();
    expect(waiting.status).toBe("PROCESSING");
    const cancelled = reduceConversation(waiting, { type: "CANCEL" });
    expect(cancelled).toEqual({ status: "IDLE" });
    expect(reduceConversation(cancelled, { type: "RESULT", result: resultFor(ID_A) })).toBe(cancelled);
  });

  it("cancelar durante la preparación descarta el arranque tardío del grabador", () => {
    const preparing = run([press("A", ID_A)]);
    expect(preparing.status).toBe("PREPARING");
    const cancelled = reduceConversation(preparing, { type: "CANCEL" });
    expect(cancelled).toEqual({ status: "IDLE" });
    expect(reduceConversation(cancelled, { type: "RECORDING_STARTED", requestId: ID_A, at: 2 })).toBe(cancelled);
  });

  it("cancelar mientras A graba deja libre el turno para B", () => {
    expect(run([{ type: "CANCEL" }, press("B", ID_B)], recordingA())).toMatchObject({
      status: "PREPARING",
      turn: { participant: "B" },
    });
  });

  it("un fallo del servidor vuelve a IDLE con el aviso en la mitad de A y permite otro turno", () => {
    const failed = reduceConversation(waitingA(), {
      type: "FAILED",
      requestId: ID_A,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(failed).toEqual({ status: "IDLE", error: { participant: "A", code: "SERVICE_UNAVAILABLE" } });
    const next = reduceConversation(failed, press("B", ID_B));
    expect(next).toMatchObject({ status: "PREPARING", turn: { participant: "B" } });
    expect(next).not.toHaveProperty("error");
  });

  it("un fallo del micrófono al preparar o al grabar no deja el botón bloqueado", () => {
    expect(
      run([press("A", ID_A), { type: "FAILED", requestId: ID_A, code: "MIC_PERMISSION_DENIED" }]),
    ).toEqual({ status: "IDLE", error: { participant: "A", code: "MIC_PERMISSION_DENIED" } });
    expect(reduceConversation(recordingA(), { type: "FAILED", requestId: ID_A, code: "RECORDER_FAILED" })).toEqual({
      status: "IDLE",
      error: { participant: "A", code: "RECORDER_FAILED" },
    });
  });
});

describe("inicio rechazado por metadatos inválidos", () => {
  it("avisa en la mitad de quien tocó, conserva el último resultado y no inicia turno", () => {
    const afterA = reduceConversation(speakingA(), { type: "SPEECH_ENDED", requestId: ID_A, reason: "done" });
    expect(reduceConversation(afterA, { type: "REJECTED", participant: "B", code: "INVALID_REQUEST" })).toEqual({
      status: "IDLE",
      last: { participant: "A", result: resultFor(ID_A) },
      error: { participant: "B", code: "INVALID_REQUEST" },
    });
  });

  it("durante un turno un rechazo no lo altera", () => {
    const recording = recordingA();
    expect(recording.status).toBe("RECORDING_A");
    expect(reduceConversation(recording, { type: "REJECTED", participant: "B", code: "INVALID_REQUEST" })).toBe(
      recording,
    );
  });
});

describe("eventos antiguos, repetidos o fuera de lugar", () => {
  it("tras cancelar A y empezar B con otro UUID, los eventos antiguos de A no afectan a B", () => {
    const preparingB = run([{ type: "CANCEL" }, press("B", ID_B)], waitingA());
    expect(preparingB).toMatchObject({ status: "PREPARING", turn: { participant: "B", requestId: ID_B } });
    expect(reduceConversation(preparingB, { type: "RECORDING_STARTED", requestId: ID_A, at: 7 })).toBe(preparingB);
    expect(reduceConversation(preparingB, { type: "FAILED", requestId: ID_A, code: "RECORDER_FAILED" })).toBe(
      preparingB,
    );

    const recordingB = reduceConversation(preparingB, { type: "RECORDING_STARTED", requestId: ID_B, at: 8 });
    expect(recordingB.status).toBe("RECORDING_B");
    const oldEvents: readonly ConversationEvent[] = [
      { type: "RECORDING_STARTED", requestId: ID_A, at: 9 },
      { type: "TIME_LIMIT", requestId: ID_A },
      { type: "FAILED", requestId: ID_A, code: "TIMEOUT" },
      { type: "RESULT", result: resultFor(ID_A) },
    ];
    for (const old of oldEvents) expect(reduceConversation(recordingB, old)).toBe(recordingB);

    const waitingB = run([press("B", ID_B), { type: "AUDIO_READY", requestId: ID_B }], recordingB);
    expect(waitingB).toMatchObject({ status: "PROCESSING", phase: "waiting_server" });
    expect(reduceConversation(waitingB, { type: "RESULT", result: resultFor(ID_A) })).toBe(waitingB);
    expect(reduceConversation(waitingB, { type: "FAILED", requestId: ID_A, code: "TIMEOUT" })).toBe(waitingB);
    expect(reduceConversation(waitingB, { type: "RESULT", result: resultFor(ID_B) })).toMatchObject({
      status: "SPEAKING",
      turn: { participant: "B", requestId: ID_B },
    });
  });

  it("un TIME_LIMIT repetido tras detener no vuelve a parar", () => {
    const stoppedByLimit = reduceConversation(recordingA(), { type: "TIME_LIMIT", requestId: ID_A });
    expect(stoppedByLimit).toMatchObject({ status: "PROCESSING", phase: "finalizing_audio" });
    expect(reduceConversation(stoppedByLimit, { type: "TIME_LIMIT", requestId: ID_A })).toBe(stoppedByLimit);

    const stoppedByTap = reduceConversation(recordingA(), press("A", ID_B));
    expect(stoppedByTap.status).toBe("PROCESSING");
    expect(reduceConversation(stoppedByTap, { type: "TIME_LIMIT", requestId: ID_A })).toBe(stoppedByTap);
  });

  const outOfPlace: readonly {
    label: string;
    status: ConversationState["status"];
    build: () => ConversationState;
    event: ConversationEvent;
  }[] = [
    { label: "PREPARING + TIME_LIMIT", status: "PREPARING", build: preparingA, event: { type: "TIME_LIMIT", requestId: ID_A } },
    { label: "PREPARING + AUDIO_READY", status: "PREPARING", build: preparingA, event: { type: "AUDIO_READY", requestId: ID_A } },
    { label: "PREPARING + RESULT", status: "PREPARING", build: preparingA, event: { type: "RESULT", result: resultFor(ID_A) } },
    {
      label: "PREPARING + SPEECH_ENDED",
      status: "PREPARING",
      build: preparingA,
      event: { type: "SPEECH_ENDED", requestId: ID_A, reason: "done" },
    },
    {
      label: "RECORDING_A + RECORDING_STARTED repetido",
      status: "RECORDING_A",
      build: recordingA,
      event: { type: "RECORDING_STARTED", requestId: ID_A, at: 2_000 },
    },
    {
      label: "RECORDING_A + AUDIO_READY antes de detener",
      status: "RECORDING_A",
      build: recordingA,
      event: { type: "AUDIO_READY", requestId: ID_A },
    },
    { label: "RECORDING_A + RESULT", status: "RECORDING_A", build: recordingA, event: { type: "RESULT", result: resultFor(ID_A) } },
    {
      label: "RECORDING_A + SPEECH_ENDED",
      status: "RECORDING_A",
      build: recordingA,
      event: { type: "SPEECH_ENDED", requestId: ID_A, reason: "done" },
    },
    {
      label: "PROCESSING + RECORDING_STARTED",
      status: "PROCESSING",
      build: waitingA,
      event: { type: "RECORDING_STARTED", requestId: ID_A, at: 3_000 },
    },
    { label: "PROCESSING + TIME_LIMIT", status: "PROCESSING", build: waitingA, event: { type: "TIME_LIMIT", requestId: ID_A } },
    {
      label: "PROCESSING + SPEECH_ENDED",
      status: "PROCESSING",
      build: waitingA,
      event: { type: "SPEECH_ENDED", requestId: ID_A, reason: "done" },
    },
    { label: "SPEAKING + RESULT repetido", status: "SPEAKING", build: speakingA, event: { type: "RESULT", result: resultFor(ID_A) } },
    {
      label: "SPEAKING + FAILED",
      status: "SPEAKING",
      build: speakingA,
      event: { type: "FAILED", requestId: ID_A, code: "TIMEOUT" },
    },
    { label: "IDLE + RESULT sin turno", status: "IDLE", build: () => initialConversation, event: { type: "RESULT", result: resultFor(ID_A) } },
    { label: "IDLE + CANCEL", status: "IDLE", build: () => initialConversation, event: { type: "CANCEL" } },
  ];

  it.each(outOfPlace)("un evento que no corresponde al estado no avanza: $label", ({ status, build, event }) => {
    const state = build();
    expect(state.status).toBe(status);
    expect(reduceConversation(state, event)).toBe(state);
  });
});

describe("voz y fin de la conversación", () => {
  it("durante la voz un toque solo la detiene; no se graba hasta que termine de detenerse", () => {
    const speaking = speakingA();
    expect(speaking.status).toBe("SPEAKING");
    const stopping = reduceConversation(speaking, press("B", ID_B));
    expect(stopping).toMatchObject({ status: "SPEAKING", stopping: true });
    expect(reduceConversation(stopping, press("B", ID_B))).toBe(stopping);

    const idle = reduceConversation(stopping, { type: "SPEECH_ENDED", requestId: ID_A, reason: "stopped" });
    expect(idle).toEqual({ status: "IDLE", last: { participant: "A", result: resultFor(ID_A) } });
    expect(reduceConversation(idle, press("B", ID_B))).toMatchObject({
      status: "PREPARING",
      turn: { participant: "B" },
    });
  });

  it("si no hay voz o se interrumpe, el texto se conserva y el aviso va a quien escucha", () => {
    expect(
      reduceConversation(speakingA(), { type: "SPEECH_ENDED", requestId: ID_A, reason: "unavailable" }),
    ).toEqual({
      status: "IDLE",
      last: { participant: "A", result: resultFor(ID_A) },
      error: { participant: "B", code: "VOICE_UNAVAILABLE" },
    });
    expect(
      reduceConversation(speakingA(), { type: "SPEECH_ENDED", requestId: ID_A, reason: "error" }),
    ).toMatchObject({ status: "IDLE", error: { participant: "B", code: "PLAYBACK_INTERRUPTED" } });
  });

  it("el fin de voz de otro turno se ignora", () => {
    const speaking = speakingA();
    expect(speaking.status).toBe("SPEAKING");
    expect(reduceConversation(speaking, { type: "SPEECH_ENDED", requestId: ID_B, reason: "done" })).toBe(speaking);
  });

  it("el último resultado sigue visible mientras B responde y se sustituye con su respuesta", () => {
    const afterA = reduceConversation(speakingA(), { type: "SPEECH_ENDED", requestId: ID_A, reason: "done" });
    const recordingB = run([press("B", ID_B), { type: "RECORDING_STARTED", requestId: ID_B, at: 9 }], afterA);
    expect(recordingB).toMatchObject({ status: "RECORDING_B", last: { participant: "A" } });

    const speakingB = run(
      [press("B", ID_B), { type: "AUDIO_READY", requestId: ID_B }, { type: "RESULT", result: resultFor(ID_B) }],
      recordingB,
    );
    expect(speakingB).toMatchObject({
      status: "SPEAKING",
      last: { participant: "B", result: { requestId: ID_B } },
    });
  });

  it("RESET (cerrar sesión o desmontar) limpia todo desde cualquier estado", () => {
    for (const state of [run([press("A", ID_A)]), recordingA(), waitingA(), speakingA()]) {
      expect(state.status).not.toBe("IDLE");
      expect(reduceConversation(state, { type: "RESET" })).toEqual({ status: "IDLE" });
    }
  });
});

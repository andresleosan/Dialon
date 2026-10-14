import type { ParseResult } from "@dialon/contracts";
import { act, renderHook } from "@testing-library/react-native";
import { AppState, Platform, type AppStateStatus } from "react-native";
import type { AudioClip, LevelListener, LocalAudio, Recording } from "./audio/capture";
import { useDemoConversation } from "./useDemoConversation";

function uuidSequence() {
  let n = 0;
  return jest.fn(() => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  });
}

async function nextDemoStep() {
  await act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe("useDemoConversation: idioma de cada persona", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("cambiar el idioma de una persona no toca el de la otra; un par igual o por validar se marca y uno válido lo limpia", async () => {
    const { result } = await renderHook(() => useDemoConversation(uuidSequence()));
    expect(result.current.pairIssue).toBeUndefined();

    await act(() => {
      result.current.selectLanguage("A", "en");
    });
    expect(result.current.languages).toEqual({ A: "en", B: "en" });
    expect(result.current.pairIssue).toBe("same");

    await act(() => {
      result.current.selectLanguage("B", "pt");
    });
    expect(result.current.languages).toEqual({ A: "en", B: "pt" });
    expect(result.current.pairIssue).toBe("pending");

    await act(() => {
      result.current.selectLanguage("B", "es");
    });
    expect(result.current.languages).toEqual({ A: "en", B: "es" });
    expect(result.current.pairIssue).toBeUndefined();
  });

  it("con un par bloqueado, tocar Hablar no inicia turno ni pide UUID", async () => {
    const createRequestId = uuidSequence();
    const { result } = await renderHook(() => useDemoConversation(createRequestId));
    await act(() => {
      result.current.selectLanguage("A", "fr");
    });
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state).toEqual({ status: "IDLE" });
    expect(createRequestId).not.toHaveBeenCalled();
  });

  it("durante PREPARING, RECORDING, PROCESSING y SPEAKING ignora cambios de idioma sin tocar idiomas ni estado", async () => {
    const { result } = await renderHook(() => useDemoConversation(uuidSequence()));
    const tryToChange = async () => {
      const before = result.current.state;
      await act(() => {
        result.current.selectLanguage("A", "pt");
        result.current.selectLanguage("B", "es");
      });
      expect(result.current.languages).toEqual({ A: "es", B: "en" });
      expect(result.current.state).toBe(before);
    };

    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state.status).toBe("PREPARING");
    await tryToChange();
    await nextDemoStep();
    expect(result.current.state.status).toBe("RECORDING_A");
    await tryToChange();
    await act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state.status).toBe("PROCESSING");
    await tryToChange();
    await nextDemoStep();
    await nextDemoStep();
    expect(result.current.state.status).toBe("SPEAKING");
    await tryToChange();

    await nextDemoStep();
    expect(result.current.state).toMatchObject({ status: "IDLE", last: { participant: "A" } });
  });

  it("repetir el idioma actual conserva el último resultado y solo un cambio real lo borra", async () => {
    const { result } = await renderHook(() => useDemoConversation(uuidSequence()));
    await act(() => {
      result.current.press("B");
    });
    await nextDemoStep();
    await act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(() => {
      result.current.press("B");
    });
    await nextDemoStep();
    await nextDemoStep();
    await nextDemoStep();
    expect(result.current.state).toMatchObject({ status: "IDLE", last: { participant: "B" } });

    await act(() => {
      result.current.selectLanguage("B", "en");
    });
    expect(result.current.state).toMatchObject({ status: "IDLE", last: { participant: "B" } });

    await act(() => {
      result.current.selectLanguage("B", "it");
    });
    expect(result.current.languages).toEqual({ A: "es", B: "it" });
    expect(result.current.state).toEqual({ status: "IDLE" });
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CLIP: AudioClip = {
  audio: { uri: "blob:dialon/clip" },
  info: { mimeType: "audio/webm", byteLength: 41_000, durationMs: 2500 },
};

/** Grabador y reproductor inyectados con guion: el test decide cuándo llega el permiso, el clip o el fin. */
function scriptedAudio() {
  const sessions: {
    signal: AbortSignal;
    started: Deferred<ParseResult<Recording>>;
    result: Deferred<ParseResult<AudioClip>>;
    stop: jest.Mock;
    onLevel?: LevelListener;
  }[] = [];
  const plays: { signal: AbortSignal; done: Deferred<undefined> }[] = [];
  const start = jest.fn((signal: AbortSignal, onLevel?: LevelListener) => {
        const session = { signal, onLevel, started: deferred<ParseResult<Recording>>(), result: deferred<ParseResult<AudioClip>>(), stop: jest.fn() };
        session.result.promise.catch(() => undefined);
        signal.addEventListener("abort", () => {
          session.started.reject(signal.reason);
          session.result.reject(signal.reason);
        });
        sessions.push(session);
        return session.started.promise;
  });
  const play = jest.fn((_clip: AudioClip, signal: AbortSignal) => {
    const done = deferred<undefined>();
    signal.addEventListener("abort", () => {
      done.resolve(undefined);
    });
    plays.push({ signal, done });
    return done.promise.then(() => undefined);
  });
  const audio: LocalAudio = { capture: { start }, player: { play } };
  const session = (index: number) => {
    const found = sessions[index];
    if (!found) throw new Error(`sin sesión ${String(index)}`);
    return found;
  };
  return {
    audio,
    start,
    play,
    sessions,
    plays,
    async grant(index = 0) {
      const { started, result, stop } = session(index);
      await act(async () => {
        started.resolve({ ok: true, value: { stop, result: result.promise } });
        await Promise.resolve();
      });
    },
    async deny(index = 0) {
      await act(async () => {
        session(index).started.resolve({ ok: false, code: "MIC_PERMISSION_DENIED", detail: "denegado" });
        await Promise.resolve();
      });
    },
    async finish(outcome: ParseResult<AudioClip>, index = 0) {
      await act(async () => {
        session(index).result.resolve(outcome);
        await Promise.resolve();
      });
    },
  };
}

describe("useDemoConversation con audio local (web)", () => {
  let appStateChange: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] });
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      appStateChange = listener;
      return { remove: jest.fn() };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    appStateChange = undefined;
  });

  async function render(audio: LocalAudio) {
    const hook = await renderHook(() => useDemoConversation(uuidSequence(), audio));
    return hook.result;
  }

  it("primer toque pide el micrófono, segundo toque detiene una vez y guarda el clip real sin resultado inventado", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state.status).toBe("PREPARING");
    expect(script.start).toHaveBeenCalledTimes(1);

    await script.grant();
    expect(result.current.state.status).toBe("RECORDING_A");
    await act(() => {
      result.current.press("B");
    });
    expect(script.sessions[0]?.stop).not.toHaveBeenCalled();
    await act(() => {
      result.current.press("A");
    });
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state).toMatchObject({ status: "PROCESSING", phase: "finalizing_audio" });
    expect(script.sessions[0]?.stop).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    await script.finish({ ok: true, value: CLIP });
    expect(result.current.state).toEqual({ status: "IDLE" });
    expect(result.current.clip).toEqual({ participant: "A", ...CLIP });
    // La simulación DEMO nunca corre en un turno grabado.
    expect(jest.getTimerCount()).toBe(0);
    expect(script.start).toHaveBeenCalledTimes(1);
  });

  it("si la grabación termina sola (límite) también guarda el clip; un fallo avisa en esa mitad sin clip", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("B");
    });
    await script.grant();
    await script.finish({ ok: true, value: CLIP });
    expect(result.current.state).toEqual({ status: "IDLE" });
    expect(result.current.clip?.participant).toBe("B");

    await act(() => {
      result.current.press("A");
    });
    expect(result.current.clip).toBeUndefined();
    await script.grant(1);
    await act(() => {
      result.current.press("A");
    });
    await script.finish({ ok: false, code: "TOO_SHORT", detail: "corto" }, 1);
    expect(result.current.state).toEqual({ status: "IDLE", error: { participant: "A", code: "TOO_SHORT" } });
    expect(result.current.clip).toBeUndefined();
  });

  it("un permiso denegado avisa MIC_PERMISSION_DENIED en esa mitad", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    await script.deny();
    expect(result.current.state).toEqual({ status: "IDLE", error: { participant: "A", code: "MIC_PERMISSION_DENIED" } });
  });

  it("cancelar con el permiso pendiente cancela la señal y un permiso tardío no empieza a grabar", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    await act(() => {
      result.current.cancel();
    });
    expect(script.sessions[0]?.signal.aborted).toBe(true);
    expect(result.current.state).toEqual({ status: "IDLE" });
    await script.grant();
    expect(result.current.state).toEqual({ status: "IDLE" });
  });

  it("cancelar grabando cancela la señal y un clip tardío no aparece en el turno nuevo", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    await script.grant();
    await act(() => {
      result.current.cancel();
    });
    expect(script.sessions[0]?.signal.aborted).toBe(true);

    await act(() => {
      result.current.press("B");
    });
    await script.finish({ ok: true, value: CLIP });
    expect(result.current.state).toMatchObject({ status: "PREPARING", turn: { participant: "B" } });
    expect(result.current.clip).toBeUndefined();
  });

  it("al pasar a segundo plano se cancela el turno y para la reproducción; al desmontar se cancela todo", async () => {
    const script = scriptedAudio();
    const hook = await renderHook(() => useDemoConversation(uuidSequence(), script.audio));
    await act(() => {
      hook.result.current.press("A");
    });
    await script.grant();
    await act(() => {
      appStateChange?.("background");
    });
    expect(script.sessions[0]?.signal.aborted).toBe(true);
    expect(hook.result.current.state).toEqual({ status: "IDLE" });

    await act(() => {
      hook.result.current.press("A");
    });
    await script.grant(1);
    await script.finish({ ok: true, value: CLIP }, 1);
    await act(() => {
      hook.result.current.play();
    });
    expect(hook.result.current.playback).toBe("playing");
    await act(() => {
      appStateChange?.("background");
    });
    expect(script.plays[0]?.signal.aborted).toBe(true);
    expect(hook.result.current.playback).toBe("idle");

    await act(() => {
      hook.result.current.press("B");
    });
    await act(() => {
      hook.result.current.play();
    });
    await hook.unmount();
    expect(script.sessions[2]?.signal.aborted).toBe(true);
  });

  it("reproduce el clip a mano, lo detiene, avisa si falla y nunca suena mientras se graba otro turno", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    await script.grant();
    await script.finish({ ok: true, value: CLIP });
    expect(script.play).not.toHaveBeenCalled();

    await act(() => {
      result.current.play();
    });
    expect(script.play).toHaveBeenCalledWith({ participant: "A", ...CLIP }, expect.any(AbortSignal));
    await act(() => {
      result.current.stopPlayback();
    });
    expect(script.plays[0]?.signal.aborted).toBe(true);
    expect(result.current.playback).toBe("idle");

    await act(() => {
      result.current.play();
    });
    await act(async () => {
      script.plays[1]?.done.resolve(undefined);
      await Promise.resolve();
    });
    expect(result.current.playback).toBe("idle");

    await act(() => {
      result.current.play();
    });
    await act(async () => {
      script.plays[2]?.done.reject(new Error("falló"));
      await Promise.resolve();
    });
    expect(result.current.playback).toBe("failed");
    expect(result.current.clip).toBeDefined();

    await act(() => {
      result.current.play();
    });
    await act(() => {
      result.current.press("B");
    });
    expect(script.plays[3]?.signal.aborted).toBe(true);
    expect(result.current.clip).toBeUndefined();
    expect(result.current.playback).toBe("idle");
    await act(() => {
      result.current.play();
    });
    expect(script.play).toHaveBeenCalledTimes(4);
  });

  it("cambiar de idioma descarta el clip y repetir el mismo idioma lo conserva", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    await script.grant();
    await script.finish({ ok: true, value: CLIP });
    await act(() => {
      result.current.selectLanguage("A", "es");
    });
    expect(result.current.clip).toBeDefined();
    await act(() => {
      result.current.selectLanguage("B", "pt");
    });
    expect(result.current.clip).toBeUndefined();
  });
  it("cancelar en el mismo instante en que llega el permiso o el clip invalida la grabación al momento y no publica nada", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    await act(() => {
      result.current.press("A");
    });
    const first = script.sessions[0];
    if (!first) throw new Error("sin sesión");
    await act(async () => {
      first.started.resolve({ ok: true, value: { stop: first.stop, result: first.result.promise } });
      result.current.cancel();
      // La señal se cancela en el acto, antes de que React limpie el efecto del turno.
      expect(first.signal.aborted).toBe(true);
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "IDLE" });

    await act(() => {
      result.current.press("B");
    });
    await script.grant(1);
    const second = script.sessions[1];
    if (!second) throw new Error("sin sesión");
    await act(() => {
      result.current.press("B");
    });
    // El turno nuevo es dueño de su propia grabación: el segundo toque no toca la antigua.
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(first.stop).not.toHaveBeenCalled();
    await act(async () => {
      second.result.resolve({ ok: true, value: CLIP });
      result.current.cancel();
      await Promise.resolve();
    });
    expect(second.signal.aborted).toBe(true);
    expect(result.current.clip).toBeUndefined();
    expect(result.current.state).toEqual({ status: "IDLE" });
  });

  it("en web, pagehide cancela el permiso pendiente (uno tardío no graba), para la reproducción y descarta el clip", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    const listeners = new Map<string, () => void>();
    const added = jest.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    });
    const removed = jest.fn((type: string) => {
      listeners.delete(type);
    });
    const original = {
      add: Object.getOwnPropertyDescriptor(globalThis, "addEventListener"),
      remove: Object.getOwnPropertyDescriptor(globalThis, "removeEventListener"),
    };
    Object.defineProperty(globalThis, "addEventListener", { configurable: true, writable: true, value: added });
    Object.defineProperty(globalThis, "removeEventListener", { configurable: true, writable: true, value: removed });
    const pagehide = async () => {
      await act(() => {
        listeners.get("pagehide")?.();
      });
    };
    try {
      const script = scriptedAudio();
      const hook = await renderHook(() => useDemoConversation(uuidSequence(), script.audio));
      await act(() => {
        hook.result.current.press("A");
      });
      await script.grant();
      await script.finish({ ok: true, value: CLIP });
      await act(() => {
        hook.result.current.play();
      });
      await pagehide();
      expect(script.plays[0]?.signal.aborted).toBe(true);
      expect(hook.result.current.playback).toBe("idle");
      expect(hook.result.current.clip).toBeUndefined();

      await act(() => {
        hook.result.current.press("A");
      });
      await pagehide();
      expect(script.sessions[1]?.signal.aborted).toBe(true);
      expect(hook.result.current.state).toEqual({ status: "IDLE" });
      await script.grant(1);
      expect(hook.result.current.state).toEqual({ status: "IDLE" });

      await hook.unmount();
      expect(removed).toHaveBeenCalledWith("pagehide", expect.any(Function));
      expect(listeners.has("pagehide")).toBe(false);
    } finally {
      for (const [name, descriptor] of [
        ["addEventListener", original.add],
        ["removeEventListener", original.remove],
      ] as const) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
  it("niveles reales solo de la grabación activa: historia acotada, null los oculta y se reinician al terminar, cancelar o empezar otro turno", async () => {
    const script = scriptedAudio();
    const result = await render(script.audio);
    const level = async (value: number | null, index = 0) => {
      await act(() => {
        script.sessions[index]?.onLevel?.(value);
      });
    };
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.levels).toEqual([]);
    await script.grant();
    await level(0);
    await level(0.5);
    expect(result.current.levels).toEqual([0, 0.5]);
    for (let i = 0; i < 60; i += 1) await level(0.1);
    expect(result.current.levels.length).toBeLessThan(60);
    expect(result.current.levels.at(-1)).toBe(0.1);
    await level(null);
    expect(result.current.levels).toEqual([]);
    await level(0.2);
    expect(result.current.levels).toEqual([0.2]);

    // El segundo toque apaga el medidor: un nivel que llegue tarde ya no pinta nada.
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.levels).toEqual([]);
    await level(0.9);
    expect(result.current.levels).toEqual([]);
    await script.finish({ ok: true, value: CLIP });
    expect(result.current.levels).toEqual([]);

    await act(() => {
      result.current.press("B");
    });
    await script.grant(1);
    await level(0.3, 1);
    expect(result.current.levels).toEqual([0.3]);
    await act(() => {
      result.current.cancel();
    });
    expect(result.current.levels).toEqual([]);
    await level(0.7, 1);
    await level(0.7, 0);
    expect(result.current.levels).toEqual([]);

    await act(() => {
      result.current.press("A");
    });
    await script.grant(2);
    expect(result.current.levels).toEqual([]);
    await level(0.4, 2);
    expect(result.current.levels).toEqual([0.4]);
  });
});

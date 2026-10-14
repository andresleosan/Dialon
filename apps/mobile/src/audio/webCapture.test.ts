import { DEFAULT_LIMITS } from "@dialon/contracts";
import type { AudioClip } from "./capture";
import { webAudioCapture } from "./webCapture";

// Blob real de Node solo para las pruebas: el Blob del entorno de React Native no guarda bytes.
const { Blob: NodeBlob } = jest.requireActual<{ Blob: typeof Blob }>("node:buffer");

// Fronteras del navegador simuladas (getUserMedia, MediaRecorder y la pista del micrófono): sin micrófono ni red.

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

class FakeTrack {
  onended: (() => void) | null = null;
  readonly stop = jest.fn();
  /** El navegador cierra la pista por su cuenta: micrófono desconectado o permiso retirado. */
  end() {
    this.onended?.();
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

let supportedTypes: string[];
let recorders: FakeRecorder[];
let mic: Deferred<FakeStream>;
let failOnConstruct: boolean;

class FakeRecorder {
  static isTypeSupported(type: string) {
    return supportedTypes.includes(type);
  }

  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly mimeType: string;
  /** Bytes del último trozo que el navegador entrega al parar; `null` simula un grabador que nunca termina. */
  finalBytes: number | null = 100;
  readonly start = jest.fn(() => {
    this.state = "recording";
  });
  readonly stop = jest.fn(() => {
    this.state = "inactive";
    const { finalBytes } = this;
    if (finalBytes === null) return;
    // Como el navegador: después entrega el último trozo y luego «stop».
    queueMicrotask(() => {
      this.emit(finalBytes);
      this.onstop?.();
    });
  });

  constructor(
    readonly stream: FakeStream,
    options: { mimeType: string },
  ) {
    if (failOnConstruct) throw new Error("NotSupportedError");
    this.mimeType = options.mimeType;
    recorders.push(this);
  }

  emit(bytes: number) {
    this.ondataavailable?.({ data: new NodeBlob([new Uint8Array(bytes)], { type: this.mimeType }) });
  }
}

const getUserMedia = jest.fn(() => {
  mic = deferred<FakeStream>();
  return mic.promise;
});
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalBlob = globalThis.Blob;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"], now: 0 });
  // Reloj monotónico del navegador ligado al reloj simulado: avanza solo cuando el test lo dice.
  jest.spyOn(performance, "now").mockImplementation(() => Date.now());
  supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  recorders = [];
  failOnConstruct = false;
  getUserMedia.mockClear();
  Object.assign(globalThis, { MediaRecorder: FakeRecorder, Blob: NodeBlob });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia } } });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis, "MediaRecorder");
  Object.assign(globalThis, { Blob: originalBlob });
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

function elapse(ms: number) {
  jest.advanceTimersByTime(ms);
}

async function startRecording(controller = new AbortController(), onLevel?: (level: number | null) => void) {
  const pending = webAudioCapture.start(controller.signal, onLevel);
  const stream = new FakeStream();
  mic.resolve(stream);
  const started = await pending;
  if (!started.ok) throw new Error(`no empezó: ${started.code}`);
  const recorder = recorders.at(-1);
  const track = stream.tracks[0];
  if (!recorder || !track) throw new Error("sin grabador");
  return { recording: started.value, recorder, track, controller };
}

async function clipBytes(clip: AudioClip) {
  if (!(clip.audio instanceof NodeBlob)) throw new Error("se esperaba un Blob");
  return (await clip.audio.arrayBuffer()).byteLength;
}

describe("webAudioCapture: clip real", () => {
  it("entrega un Blob real con el tipo elegido, todos los trozos (también el final) y la duración monotónica", async () => {
    const { recording, recorder, track } = await startRecording();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder.mimeType).toBe("audio/webm;codecs=opus");
    expect(recorder.start).toHaveBeenCalledTimes(1);

    elapse(1000);
    recorder.emit(4000);
    recorder.emit(0);
    elapse(1500);
    recording.stop();
    // El micrófono se apaga al terminar, antes de que el navegador entregue el último trozo.
    expect(track.stop).toHaveBeenCalled();

    const result = await recording.result;
    if (!result.ok) throw new Error(`sin clip: ${result.code}`);
    expect(result.value.info).toEqual({ mimeType: "audio/webm", byteLength: 4100, durationMs: 2500 });
    expect(result.value.audio).toBeInstanceOf(NodeBlob);
    expect(await clipBytes(result.value)).toBe(4100);
    expect(result.value.audio instanceof NodeBlob && result.value.audio.type).toBe("audio/webm;codecs=opus");
    expect(jest.getTimerCount()).toBe(0);
    expect(recorder.ondataavailable).toBeNull();
  });

  it("elige en tiempo de ejecución el primer tipo que admiten el navegador y el contrato (AAC en MP4 en Safari)", async () => {
    supportedTypes = ["audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
    const { recording, recorder } = await startRecording();
    expect(recorder.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
    elapse(800);
    recording.stop();
    await expect(recording.result).resolves.toMatchObject({
      ok: true,
      value: { info: { mimeType: "audio/mp4", byteLength: 100, durationMs: 800 } },
    });
  });

  it("sin un tipo del contrato, sin MediaRecorder o sin getUserMedia avisa RECORDER_FAILED sin pedir el micrófono", async () => {
    const { signal } = new AbortController();
    supportedTypes = ["audio/ogg;codecs=opus"];
    await expect(webAudioCapture.start(signal)).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });

    supportedTypes = ["audio/webm"];
    Reflect.deleteProperty(globalThis, "MediaRecorder");
    await expect(webAudioCapture.start(signal)).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });

    Object.assign(globalThis, { MediaRecorder: FakeRecorder });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await expect(webAudioCapture.start(signal)).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("rechaza audio vacío (INVALID_AUDIO) y menos de 300 ms (TOO_SHORT); 300 ms justos valen", async () => {
    let session = await startRecording();
    session.recorder.finalBytes = 0;
    elapse(1000);
    session.recording.stop();
    await expect(session.recording.result).resolves.toMatchObject({ ok: false, code: "INVALID_AUDIO" });

    session = await startRecording();
    elapse(DEFAULT_LIMITS.minAudioMs - 1);
    session.recording.stop();
    await expect(session.recording.result).resolves.toMatchObject({ ok: false, code: "TOO_SHORT" });

    session = await startRecording();
    elapse(DEFAULT_LIMITS.minAudioMs);
    session.recording.stop();
    await expect(session.recording.result).resolves.toMatchObject({ ok: true, value: { info: { durationMs: 300 } } });
  });
});

function expectReleased(recorder: FakeRecorder, track: FakeTrack) {
  expect(track.stop).toHaveBeenCalled();
  expect(recorder.state).toBe("inactive");
  expect(recorder.ondataavailable).toBeNull();
  expect(recorder.onstop).toBeNull();
  expect(track.onended).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
}

describe("webAudioCapture: permiso y cancelación", () => {
  it("un permiso denegado avisa MIC_PERMISSION_DENIED y otro fallo del micrófono RECORDER_FAILED, sin crear grabador", async () => {
    const { signal } = new AbortController();
    let pending = webAudioCapture.start(signal);
    mic.reject(new DOMException("denegado", "NotAllowedError"));
    await expect(pending).resolves.toMatchObject({ ok: false, code: "MIC_PERMISSION_DENIED" });

    pending = webAudioCapture.start(signal);
    mic.reject(new DOMException("sin micrófono", "NotFoundError"));
    await expect(pending).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expect(recorders).toHaveLength(0);
  });

  it("cancelar con el permiso pendiente rechaza al momento y apaga el micrófono si se concede tarde", async () => {
    const controller = new AbortController();
    const pending = webAudioCapture.start(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const late = new FakeStream();
    mic.resolve(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.tracks[0]?.stop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
  });

  it("con la señal ya cancelada no pide el micrófono", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(webAudioCapture.start(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("cancelar grabando libera micrófono, grabador y temporizadores, y no entrega audio aunque lleguen trozos", async () => {
    const { recording, recorder, track, controller } = await startRecording();
    elapse(1000);
    recorder.emit(500);
    controller.abort();
    await expect(recording.result).rejects.toMatchObject({ name: "AbortError" });
    expectReleased(recorder, track);
  });

  it("cancelar justo después del segundo toque gana a la finalización: ningún clip", async () => {
    const { recording, recorder, track, controller } = await startRecording();
    elapse(1000);
    recording.stop();
    controller.abort();
    await expect(recording.result).rejects.toMatchObject({ name: "AbortError" });
    expectReleased(recorder, track);
  });

  it("el segundo toque detiene una sola vez y cancelar después de entregar el clip no cambia nada", async () => {
    const { recording, recorder, controller } = await startRecording();
    elapse(1000);
    recording.stop();
    recording.stop();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    const result = await recording.result;
    controller.abort();
    expect(result.ok).toBe(true);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});

describe("webAudioCapture: límites y fallos", () => {
  it("se detiene sola a los 29,5 s y entrega un clip dentro del máximo del contrato", async () => {
    const { recording, recorder, track } = await startRecording();
    elapse(DEFAULT_LIMITS.maxAudioMs - 501);
    expect(recorder.stop).not.toHaveBeenCalled();
    elapse(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    await expect(recording.result).resolves.toMatchObject({ ok: true, value: { info: { durationMs: 29_500 } } });
  });

  it("si el temporizador llega tarde (pestaña ralentizada) la duración real supera el máximo: AUDIO_TOO_LONG", async () => {
    const { recording } = await startRecording();
    jest.setSystemTime(Date.now() + 2000);
    elapse(DEFAULT_LIMITS.maxAudioMs - 500);
    await expect(recording.result).resolves.toMatchObject({ ok: false, code: "AUDIO_TOO_LONG" });
  });

  it("al pasar de 2 MiB se corta en el momento (AUDIO_TOO_LARGE) y libera todo; 2 MiB justos valen", async () => {
    let session = await startRecording();
    session.recorder.emit(DEFAULT_LIMITS.maxAudioBytes);
    session.recorder.emit(1);
    await expect(session.recording.result).resolves.toMatchObject({ ok: false, code: "AUDIO_TOO_LARGE" });
    expectReleased(session.recorder, session.track);

    session = await startRecording();
    session.recorder.finalBytes = 0;
    session.recorder.emit(DEFAULT_LIMITS.maxAudioBytes);
    elapse(1000);
    session.recording.stop();
    await expect(session.recording.result).resolves.toMatchObject({
      ok: true,
      value: { info: { byteLength: DEFAULT_LIMITS.maxAudioBytes } },
    });
  });

  it("un error del grabador o el fin inesperado de la pista avisan RECORDER_FAILED y liberan todo", async () => {
    let session = await startRecording();
    session.recorder.onerror?.();
    await expect(session.recording.result).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expectReleased(session.recorder, session.track);

    session = await startRecording();
    session.track.end();
    await expect(session.recording.result).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expectReleased(session.recorder, session.track);
  });

  it("si el navegador no termina de finalizar en 3 s avisa RECORDER_FAILED y libera todo", async () => {
    const { recording, recorder, track } = await startRecording();
    recorder.finalBytes = null;
    elapse(1000);
    recording.stop();
    elapse(2999);
    let settled = false;
    void recording.result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    elapse(1);
    await expect(recording.result).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expectReleased(recorder, track);
  });

  it("si MediaRecorder no puede crearse, apaga el micrófono y avisa RECORDER_FAILED", async () => {
    failOnConstruct = true;
    const pending = webAudioCapture.start(new AbortController().signal);
    const stream = new FakeStream();
    mic.resolve(stream);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expect(stream.tracks[0]?.stop).toHaveBeenCalled();
  });
});

describe("webAudioCapture: getUserMedia que lanza en el acto", () => {
  it("avisa RECORDER_FAILED y no deja escuchas en la señal", async () => {
    const { signal } = new AbortController();
    const added = jest.spyOn(signal, "addEventListener");
    const removed = jest.spyOn(signal, "removeEventListener");
    getUserMedia.mockImplementationOnce(() => {
      throw new TypeError("restricciones inválidas");
    });
    await expect(webAudioCapture.start(signal)).resolves.toMatchObject({ ok: false, code: "RECORDER_FAILED" });
    expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
  });
});

describe("webAudioCapture: medidor de intensidad sobre el mismo micrófono", () => {
  let contexts: { stream: unknown; close: jest.Mock; source: { connect: jest.Mock; disconnect: jest.Mock } }[];
  let frames: ((time: number) => void)[];

  beforeEach(() => {
    contexts = [];
    frames = [];
    class FakeContext {
      state = "running";
      readonly close = jest.fn(() => Promise.resolve());
      readonly source = { connect: jest.fn(), disconnect: jest.fn() };
      stream: unknown;
      constructor() {
        contexts.push(this);
      }
      createMediaStreamSource(stream: unknown) {
        this.stream = stream;
        return this.source;
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          connect: jest.fn(),
          getFloatTimeDomainData: (out: Float32Array) => {
            out.fill(0.3);
          },
        };
      }
    }
    Object.assign(globalThis, {
      AudioContext: FakeContext,
      requestAnimationFrame: (callback: (time: number) => void) => frames.push(callback),
      cancelAnimationFrame: () => undefined,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "AudioContext");
  });

  function paint(time: number) {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(time);
  }

  it("una sola petición de micrófono: el medidor analiza el mismo stream que graba y entrega niveles reales", async () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    const { recording, recorder } = await startRecording(undefined, onLevel);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.stream).toBe(recorder.stream);
    paint(0);
    expect(onLevel.mock.calls[0]?.[0]).toBeCloseTo(0.3, 5);

    elapse(1000);
    recording.stop();
    // El medidor se apaga con el segundo toque, a la vez que el micrófono.
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);
    paint(100);
    expect(onLevel).toHaveBeenCalledTimes(1);
    await expect(recording.result).resolves.toMatchObject({ ok: true });
  });

  it("cancelar, un error o el límite de tiempo también sueltan el medidor", async () => {
    let session = await startRecording(undefined, jest.fn());
    session.controller.abort();
    await expect(session.recording.result).rejects.toMatchObject({ name: "AbortError" });
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);

    session = await startRecording(undefined, jest.fn());
    session.recorder.onerror?.();
    await session.recording.result;
    expect(contexts[1]?.close).toHaveBeenCalledTimes(1);

    session = await startRecording(undefined, jest.fn());
    elapse(DEFAULT_LIMITS.maxAudioMs - 500);
    expect(contexts[2]?.close).toHaveBeenCalledTimes(1);
    await expect(session.recording.result).resolves.toMatchObject({ ok: true });
  });

  it("si el medidor no puede crearse, la grabación sigue intacta y solo avisa null", async () => {
    Object.assign(globalThis, {
      AudioContext: jest.fn(() => {
        throw new Error("sin Web Audio");
      }),
    });
    const onLevel = jest.fn<undefined, [number | null]>();
    const { recording } = await startRecording(undefined, onLevel);
    expect(onLevel).toHaveBeenCalledWith(null);
    elapse(1000);
    recording.stop();
    await expect(recording.result).resolves.toMatchObject({ ok: true, value: { info: { durationMs: 1000 } } });
  });

  it("sin onLevel no crea ningún AudioContext", async () => {
    const { recording } = await startRecording();
    expect(contexts).toHaveLength(0);
    recording.stop();
    await recording.result;
  });

  it("sin Web Audio y con un oyente que lanza, la grabación sigue con una sola petición de micrófono", async () => {
    Reflect.deleteProperty(globalThis, "AudioContext");
    const onLevel = jest.fn<undefined, [number | null]>(() => {
      throw new Error("oyente roto");
    });
    const { recording } = await startRecording(undefined, onLevel);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    elapse(1000);
    recording.stop();
    await expect(recording.result).resolves.toMatchObject({ ok: true, value: { info: { durationMs: 1000 } } });
  });
});

import { rmsLevel, startLevelMeter } from "./webLevelMeter";

// Web Audio y cuadros de animación simulados: sin micrófono ni altavoz. Las muestras son datos sintéticos.

let samples: Float32Array;
let contexts: FakeContext[];
let frames: Map<number, (time: number) => void>;
let nextFrameId: number;

class FakeNode {
  readonly connect = jest.fn();
  readonly disconnect = jest.fn();
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  readonly getFloatTimeDomainData = jest.fn((out: Float32Array) => {
    out.set(samples.subarray(0, out.length));
  });
}

class FakeContext {
  state: "running" | "suspended" | "closed" = "running";
  readonly destination = new FakeNode();
  readonly source = new FakeNode();
  readonly analyser = new FakeAnalyser();
  resumeResult: Promise<void> = Promise.resolve();
  readonly resume = jest.fn(() => this.resumeResult);
  readonly close = jest.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  readonly createMediaStreamSource = jest.fn(() => this.source);
  readonly createAnalyser = jest.fn(() => this.analyser);

  constructor() {
    contexts.push(this);
  }
}

const stream = { id: "mismo-stream" } as unknown as MediaStream;

function context() {
  const found = contexts[0];
  if (!found) throw new Error("sin AudioContext");
  return found;
}

/** El navegador pinta un cuadro en `time` ms. */
function frame(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(time);
}

function fill(value: number) {
  samples = new Float32Array(2048).fill(value);
}

beforeEach(() => {
  contexts = [];
  frames = new Map();
  nextFrameId = 0;
  fill(0);
  Object.assign(globalThis, {
    AudioContext: FakeContext,
    requestAnimationFrame: jest.fn((callback: (time: number) => void) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    }),
    cancelAnimationFrame: jest.fn((id: number) => {
      frames.delete(id);
    }),
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "AudioContext");
});

describe("rmsLevel", () => {
  it("silencio es 0, una señal constante es su amplitud y un seno completo ≈ 0,707", () => {
    expect(rmsLevel(new Float32Array(512))).toBe(0);
    expect(rmsLevel(new Float32Array(512).fill(0.25))).toBeCloseTo(0.25, 5);
    const sine = Float32Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
    expect(rmsLevel(sine)).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("acota a 0..1 y un valor no finito cuenta como 0", () => {
    expect(rmsLevel(new Float32Array(8).fill(3))).toBe(1);
    expect(rmsLevel(Float32Array.of(Number.NaN, 0.5))).toBe(0);
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });
});

describe("startLevelMeter", () => {
  it("analiza el mismo stream sin conectarlo nunca a los altavoces y entrega niveles reales a ~20 Hz", () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    startLevelMeter(stream, onLevel);
    const ctx = context();
    expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(ctx.analyser.connect).not.toHaveBeenCalled();
    expect(ctx.source.connect).not.toHaveBeenCalledWith(ctx.destination);

    frame(0);
    expect(onLevel).toHaveBeenLastCalledWith(0);
    fill(0.4);
    frame(16);
    frame(33);
    expect(onLevel).toHaveBeenCalledTimes(1);
    frame(50);
    expect(onLevel).toHaveBeenCalledTimes(2);
    expect(onLevel.mock.calls[1]?.[0]).toBeCloseTo(0.4, 5);
  });

  it("detener cancela el cuadro pendiente, desconecta, cierra el contexto una vez y no entrega más niveles", () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    const stop = startLevelMeter(stream, onLevel);
    frame(0);
    stop();
    stop();
    const ctx = context();
    expect(frames.size).toBe(0);
    expect(ctx.source.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    fill(0.9);
    frame(100);
    expect(onLevel).toHaveBeenCalledTimes(1);
    expect(onLevel).not.toHaveBeenCalledWith(null);
  });

  it("con el contexto suspendido no inventa silencio: no entrega niveles hasta que de verdad suena", async () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    let resume!: () => void;
    Object.assign(globalThis, {
      AudioContext: class extends FakeContext {
        override state: "running" | "suspended" | "closed" = "suspended";
        override resumeResult = new Promise<void>((resolve) => {
          resume = () => {
            this.state = "running";
            resolve();
          };
        });
      },
    });
    startLevelMeter(stream, onLevel);
    expect(context().resume).toHaveBeenCalled();
    frame(0);
    expect(onLevel).not.toHaveBeenCalled();
    resume();
    await Promise.resolve();
    fill(0.2);
    frame(60);
    expect(onLevel.mock.calls[0]?.[0]).toBeCloseTo(0.2, 5);
  });

  it("sin Web Audio, si el contexto no se puede crear o si muestrear falla, avisa null y no lanza ni deja nada vivo", () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    Reflect.deleteProperty(globalThis, "AudioContext");
    expect(() => {
      startLevelMeter(stream, onLevel)();
    }).not.toThrow();
    expect(onLevel).toHaveBeenLastCalledWith(null);

    Object.assign(globalThis, {
      AudioContext: jest.fn(() => {
        throw new Error("NotAllowedError");
      }),
    });
    onLevel.mockClear();
    expect(() => startLevelMeter(stream, onLevel)).not.toThrow();
    expect(onLevel).toHaveBeenLastCalledWith(null);
    expect(frames.size).toBe(0);

    Object.assign(globalThis, { AudioContext: FakeContext });
    onLevel.mockClear();
    startLevelMeter(stream, onLevel);
    context().analyser.getFloatTimeDomainData.mockImplementation(() => {
      throw new Error("roto");
    });
    frame(0);
    expect(onLevel).toHaveBeenLastCalledWith(null);
    expect(context().close).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("si reanudar se rechaza, apaga el medidor; si se resuelve tarde tras detener, no revive", async () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    Object.assign(globalThis, {
      AudioContext: class extends FakeContext {
        override state: "running" | "suspended" | "closed" = "suspended";
        override resumeResult = Promise.reject(new Error("sin gesto"));
      },
    });
    startLevelMeter(stream, onLevel);
    await Promise.resolve();
    await Promise.resolve();
    expect(onLevel).toHaveBeenLastCalledWith(null);
    expect(context().close).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);

    contexts = [];
    let resume!: () => void;
    Object.assign(globalThis, {
      AudioContext: class extends FakeContext {
        override state: "running" | "suspended" | "closed" = "suspended";
        override resumeResult = new Promise<void>((resolve) => {
          resume = () => {
            this.state = "running";
            resolve();
          };
        });
      },
    });
    onLevel.mockClear();
    const stop = startLevelMeter(stream, onLevel);
    stop();
    resume();
    await Promise.resolve();
    frame(0);
    expect(onLevel).not.toHaveBeenCalled();
    expect(context().close).toHaveBeenCalledTimes(1);
  });

  it("si desconectar falla, igualmente suelta el analizador, cierra el contexto y no vuelve a leer", () => {
    const onLevel = jest.fn<undefined, [number | null]>();
    const stop = startLevelMeter(stream, onLevel);
    const ctx = context();
    ctx.source.disconnect.mockImplementation(() => {
      throw new Error("InvalidAccessError");
    });
    frame(0);
    expect(() => {
      stop();
    }).not.toThrow();
    expect(ctx.analyser.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    frame(100);
    expect(ctx.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(1);
    stop();
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("un oyente que lanza no escapa: ni en el respaldo sin Web Audio ni dentro de un cuadro, y el medidor se apaga", () => {
    const throwing = jest.fn(() => {
      throw new Error("oyente roto");
    });
    Reflect.deleteProperty(globalThis, "AudioContext");
    expect(() => startLevelMeter(stream, throwing)).not.toThrow();

    Object.assign(globalThis, { AudioContext: FakeContext });
    throwing.mockClear();
    startLevelMeter(stream, throwing);
    const ctx = context();
    expect(() => {
      frame(0);
    }).not.toThrow();
    // Tras el fallo no se vuelve a llamar al oyente roto a ciegas ni se sigue leyendo.
    expect(throwing).toHaveBeenCalledTimes(2);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(ctx.analyser.disconnect).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    frame(100);
    expect(ctx.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(1);
  });
});

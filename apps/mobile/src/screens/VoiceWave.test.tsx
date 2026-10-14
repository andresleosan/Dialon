import { act, render } from "@testing-library/react-native";
import { Platform } from "react-native";
import { VoiceWave } from "./VoiceWave";

// Cuadros de animación y prefers-reduced-motion simulados; los niveles son RMS literales, como los entrega el medidor.

const HEIGHT = 48;
const COLORS = { primary: "#FFFFFF", secondary: "#BFCDE7", tertiary: "#C2CEE4" };

let frames: Map<number, (time: number) => void>;
let nextFrame: number;
let now: number;
let reducedMotion: { matches: boolean; listeners: Set<() => void> };

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  frames = new Map();
  nextFrame = 0;
  now = 0;
  reducedMotion = { matches: false, listeners: new Set() };
  Object.assign(globalThis, {
    requestAnimationFrame: jest.fn((callback: (time: number) => void) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    }),
    cancelAnimationFrame: jest.fn((id: number) => {
      frames.delete(id);
    }),
    matchMedia: jest.fn((query: string) => ({
      get matches() {
        return query === "(prefers-reduced-motion: reduce)" && reducedMotion.matches;
      },
      addEventListener: (_type: string, listener: () => void) => {
        reducedMotion.listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        reducedMotion.listeners.delete(listener);
      },
    })),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "matchMedia");
});

/** El navegador pinta cuadros cada 16 ms durante `ms`. */
async function play(ms: number) {
  await act(() => {
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    }
  });
}

async function preferReducedMotion(matches: boolean) {
  reducedMotion.matches = matches;
  await act(() => {
    for (const listener of reducedMotion.listeners) listener();
  });
}

async function draw(level: number) {
  return render(<VoiceWave level={level} height={HEIGHT} colors={COLORS} />);
}

type Rendered = Awaited<ReturnType<typeof draw>>;

function paths(view: Rendered): string[] {
  return view.container
    .queryAll((node) => node.type === "path")
    .map((node) => String((node.props as { d?: unknown }).d));
}

/** Mayor separación vertical de cualquier trazo respecto a la línea central, en px. */
function spread(view: Rendered): number {
  let max = 0;
  for (const d of paths(view)) {
    const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (let i = 1; i < numbers.length; i += 2) max = Math.max(max, Math.abs((numbers[i] ?? 0) - HEIGHT / 2));
  }
  return max;
}

describe("VoiceWave (web)", () => {
  it("en silencio es una traza plana y quieta: no pide cuadros y no cambia con el tiempo", async () => {
    const view = await draw(0);
    expect(paths(view).length).toBeGreaterThan(0);
    expect(spread(view)).toBeLessThanOrEqual(1);
    const before = paths(view);
    await play(2000);
    expect(frames.size).toBe(0);
    expect(paths(view)).toEqual(before);
  });

  it("más nivel medido da más amplitud, siempre dentro de su alto", async () => {
    const view = await draw(0.01);
    await play(600);
    const quiet = spread(view);
    await view.rerender(<VoiceWave level={0.1} height={HEIGHT} colors={COLORS} />);
    await play(600);
    const voice = spread(view);
    await view.rerender(<VoiceWave level={1} height={HEIGHT} colors={COLORS} />);
    await play(600);
    const loud = spread(view);
    expect(quiet).toBeGreaterThan(1);
    expect(voice).toBeGreaterThan(quiet);
    expect(loud).toBeGreaterThan(voice);
    expect(loud).toBeLessThanOrEqual(HEIGHT / 2);
  });

  it("con voz se mueve suavemente; al callar se aplana enseguida y la fase deja de avanzar", async () => {
    const view = await draw(0.1);
    await play(200);
    const first = paths(view);
    await play(200);
    expect(paths(view)).not.toEqual(first);

    await view.rerender(<VoiceWave level={0} height={HEIGHT} colors={COLORS} />);
    await play(500);
    expect(spread(view)).toBeLessThanOrEqual(1);
    expect(frames.size).toBe(0);
    const settled = paths(view);
    await play(1000);
    expect(paths(view)).toEqual(settled);
  });

  it("con movimiento reducido muestra la intensidad medida al momento, sin cuadros ni deriva, y sigue los cambios de preferencia", async () => {
    reducedMotion.matches = true;
    const view = await draw(0.1);
    expect(spread(view)).toBeGreaterThan(1);
    expect(frames.size).toBe(0);
    const still = paths(view);
    await play(1000);
    expect(paths(view)).toEqual(still);
    await view.rerender(<VoiceWave level={0.4} height={HEIGHT} colors={COLORS} />);
    const louder = spread(view);
    expect(louder).toBeGreaterThan(spread(await draw(0.1)));

    await preferReducedMotion(false);
    expect(frames.size).toBeGreaterThan(0);
    const moving = paths(view);
    await play(300);
    expect(paths(view)).not.toEqual(moving);

    await preferReducedMotion(true);
    expect(frames.size).toBe(0);
    const stillAgain = paths(view);
    await play(500);
    expect(paths(view)).toEqual(stillAgain);
  });

  it("al desmontar cancela el cuadro pendiente y deja de escuchar la preferencia", async () => {
    const view = await draw(0.2);
    await play(100);
    expect(frames.size).toBeGreaterThan(0);
    expect(reducedMotion.listeners.size).toBe(1);
    await view.unmount();
    expect(frames.size).toBe(0);
    expect(reducedMotion.listeners.size).toBe(0);
  });
});

describe("VoiceWave: cola numérica del navegador tras la voz", () => {
  it("un RMS diminuto pero positivo tras hablar (p. ej. 1e-10) se aplana y deja de pedir cuadros; la fase no deriva", async () => {
    const view = await draw(0.1);
    await play(300);
    expect(spread(view)).toBeGreaterThan(1);

    await view.rerender(<VoiceWave level={1e-10} height={HEIGHT} colors={COLORS} />);
    await play(600);
    expect(spread(view)).toBeLessThanOrEqual(1);
    expect(frames.size).toBe(0);
    const settled = paths(view);
    await play(1000);
    expect(paths(view)).toEqual(settled);
  });
});

describe("VoiceWave: cuadros cancelados que llegan tarde", () => {
  it("tras limpiar el efecto (preferencia o desmontaje), un cuadro cancelado entregado tarde no pinta ni pide otro", async () => {
    const request = jest.mocked(globalThis.requestAnimationFrame);
    const view = await draw(0.2);
    await play(100);

    // Limpieza por cambio de preferencia: el navegador aún entrega el cuadro que ya tenía en cola.
    let stale = [...frames.values()];
    expect(stale.length).toBeGreaterThan(0);
    await preferReducedMotion(true);
    expect(frames.size).toBe(0);
    const still = paths(view);
    let requests = request.mock.calls.length;
    await act(() => {
      for (const callback of stale) callback(now + 16);
    });
    expect(frames.size).toBe(0);
    expect(request.mock.calls.length).toBe(requests);
    expect(paths(view)).toEqual(still);

    // Limpieza por desmontaje.
    await preferReducedMotion(false);
    await play(50);
    stale = [...frames.values()];
    expect(stale.length).toBeGreaterThan(0);
    await view.unmount();
    requests = request.mock.calls.length;
    await act(() => {
      for (const callback of stale) callback(now + 32);
    });
    expect(frames.size).toBe(0);
    expect(request.mock.calls.length).toBe(requests);
  });
});

describe("VoiceWave fuera de la web", () => {
  it("en nativo no dibuja nada ni pide cuadros (no hay captura nativa)", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const view = await draw(0.3);
    expect(paths(view)).toEqual([]);
    expect(frames.size).toBe(0);
  });
});

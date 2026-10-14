import type { AudioClip } from "./capture";
import { webAudioPlayer } from "./webPlayer";

// Blob real de Node solo para las pruebas: el Blob del entorno de React Native no guarda bytes.
const { Blob: NodeBlob } = jest.requireActual<{ Blob: typeof Blob }>("node:buffer");

// Frontera del navegador simulada: elemento <audio> y URLs de Blob. Sin altavoz ni red.

let players: FakeAudio[];
let playOutcome: () => Promise<void>;
let urlCount: number;

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src: string;
  readonly play = jest.fn(() => playOutcome());
  readonly pause = jest.fn();
  readonly load = jest.fn();
  readonly removeAttribute = jest.fn((name: string) => {
    if (name === "src") this.src = "";
  });

  constructor(src: string) {
    this.src = src;
    players.push(this);
  }
}

let createObjectURL: jest.SpyInstance;
let revokeObjectURL: jest.SpyInstance;

const clip: AudioClip = {
  audio: new NodeBlob([new Uint8Array(900)], { type: "audio/webm;codecs=opus" }),
  info: { mimeType: "audio/webm", byteLength: 900, durationMs: 1200 },
};

beforeEach(() => {
  players = [];
  urlCount = 0;
  playOutcome = () => Promise.resolve();
  Object.assign(globalThis, { Audio: FakeAudio });
  createObjectURL = jest.spyOn(URL, "createObjectURL").mockImplementation(() => {
    urlCount += 1;
    return `blob:dialon/${String(urlCount)}`;
  });
  revokeObjectURL = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "Audio");
});

function lastPlayer() {
  const player = players.at(-1);
  if (!player) throw new Error("no se creó reproductor");
  return player;
}

function expectReleased(player: FakeAudio, url: string) {
  expect(player.pause).toHaveBeenCalled();
  expect(player.src).toBe("");
  expect(player.onended).toBeNull();
  expect(player.onerror).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith(url);
}

describe("webAudioPlayer: reproducción local", () => {
  it("reproduce el Blob local con una URL propia, la revoca al terminar y puede repetirse", async () => {
    const first = webAudioPlayer.play(clip, new AbortController().signal);
    expect(createObjectURL).toHaveBeenCalledWith(clip.audio);
    expect(lastPlayer().src).toBe("blob:dialon/1");
    expect(lastPlayer().play).toHaveBeenCalled();
    lastPlayer().onended?.();
    await expect(first).resolves.toBeUndefined();
    expectReleased(lastPlayer(), "blob:dialon/1");

    const second = webAudioPlayer.play(clip, new AbortController().signal);
    expect(lastPlayer().src).toBe("blob:dialon/2");
    lastPlayer().onended?.();
    await expect(second).resolves.toBeUndefined();
    expectReleased(lastPlayer(), "blob:dialon/2");
  });

  it("cancelar la señal detiene en el momento, libera la URL y cumple la promesa", async () => {
    const controller = new AbortController();
    const playing = webAudioPlayer.play(clip, controller.signal);
    controller.abort();
    await expect(playing).resolves.toBeUndefined();
    expectReleased(lastPlayer(), "blob:dialon/1");
    lastPlayer().onended?.();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("si el navegador rechaza play() o el audio falla, rechaza y libera la URL", async () => {
    playOutcome = () => Promise.reject(new DOMException("bloqueado", "NotAllowedError"));
    await expect(webAudioPlayer.play(clip, new AbortController().signal)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expectReleased(lastPlayer(), "blob:dialon/1");

    playOutcome = () => new Promise<void>(() => undefined);
    const failing = webAudioPlayer.play(clip, new AbortController().signal);
    lastPlayer().onerror?.();
    await expect(failing).rejects.toBeInstanceOf(Error);
    expectReleased(lastPlayer(), "blob:dialon/2");
  });

  it("con la señal ya cancelada no crea URL ni reproductor", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(webAudioPlayer.play(clip, controller.signal)).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(players).toHaveLength(0);
  });
});

describe("webAudioPlayer: fallos síncronos y clips no locales", () => {
  it("si crear el <audio> lanza, rechaza y revoca la URL ya creada", async () => {
    Object.assign(globalThis, {
      Audio: jest.fn(() => {
        throw new Error("sin <audio>");
      }),
    });
    await expect(webAudioPlayer.play(clip, new AbortController().signal)).rejects.toThrow("sin <audio>");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:dialon/1");
  });

  it("si play() lanza en el acto, rechaza, libera el elemento y la URL y deja de escuchar la señal", async () => {
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, "removeEventListener");
    playOutcome = () => {
      throw new Error("play roto");
    };
    await expect(webAudioPlayer.play(clip, controller.signal)).rejects.toThrow("play roto");
    expectReleased(lastPlayer(), "blob:dialon/1");
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("un clip con URI (de un adaptador nativo) se rechaza sin crear URL ni <audio> ni pedir nada a la red", async () => {
    const native: AudioClip = { audio: { uri: "https://example.com/clip.m4a" }, info: clip.info };
    await expect(webAudioPlayer.play(native, new AbortController().signal)).rejects.toBeInstanceOf(TypeError);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(players).toHaveLength(0);
  });
});

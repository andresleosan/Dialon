import type { ParseResult } from "@dialon/contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AudioClip, LocalAudio, Recording } from "../audio/capture";
import type { AuthErrorCode, AuthSessionProvider, AuthUser, SignInOutcome } from "../auth/session";
import { AuthGate } from "./AuthGate";

// Puerta real (hook + pantallas + FaceToFaceScreen reales). Solo se emulan los efectos externos: la sesión del SDK
// (proveedor inyectado) y el micrófono/altavoz (LocalAudio con guion). Nada contacta con Firebase ni con Google, y
// estas pruebas no demuestran un inicio de sesión real.

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

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

function fakeSession() {
  const listeners: { onUser: (user: AuthUser | null) => void; onError: (code: AuthErrorCode) => void }[] = [];
  const signIns: Deferred<SignInOutcome>[] = [];
  const signOuts: Deferred<undefined>[] = [];
  const subscribe = jest.fn((onUser: (user: AuthUser | null) => void, onError: (code: AuthErrorCode) => void) => {
    listeners.push({ onUser, onError });
    return () => undefined;
  });
  const signInWithGoogle = jest.fn(() => {
    const pending = deferred<SignInOutcome>();
    signIns.push(pending);
    return pending.promise;
  });
  const signOut = jest.fn(() => {
    const pending = deferred<undefined>();
    signOuts.push(pending);
    return pending.promise.then(() => undefined);
  });
  const provider: AuthSessionProvider = { subscribe, signInWithGoogle, signOut };
  return {
    provider,
    subscribe,
    signInWithGoogle,
    signOut,
    async emit(user: AuthUser | null) {
      await act(() => {
        listeners.at(-1)?.onUser(user);
      });
    },
    async settleSignIn(outcome: SignInOutcome, index = 0) {
      await act(async () => {
        signIns[index]?.resolve(outcome);
        await Promise.resolve();
      });
    },
    async settleSignOut(ok: boolean, index = 0) {
      await act(async () => {
        if (ok) signOuts[index]?.resolve(undefined);
        else signOuts[index]?.reject(new Error("fallo interno"));
        await Promise.resolve();
      });
    },
  };
}

const CLIP: AudioClip = {
  audio: { uri: "blob:dialon/clip" },
  info: { mimeType: "audio/webm", byteLength: 41_000, durationMs: 2500 },
};

/** Micrófono y altavoz con guion: el test decide cuándo llega el permiso y el clip. */
function scriptedAudio() {
  const captures: {
    signal: AbortSignal;
    started: Deferred<ParseResult<Recording>>;
    result: Deferred<ParseResult<AudioClip>>;
  }[] = [];
  const plays: AbortSignal[] = [];
  const audio: LocalAudio = {
    capture: {
      start: jest.fn((signal: AbortSignal) => {
        const session = { signal, started: deferred<ParseResult<Recording>>(), result: deferred<ParseResult<AudioClip>>() };
        session.result.promise.catch(() => undefined);
        signal.addEventListener("abort", () => {
          session.started.reject(signal.reason);
          session.result.reject(signal.reason);
        });
        captures.push(session);
        return session.started.promise;
      }),
    },
    player: {
      play: jest.fn((_clip: AudioClip, signal: AbortSignal) => {
        plays.push(signal);
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            resolve();
          });
        });
      }),
    },
  };
  return {
    audio,
    captures,
    plays,
    async grant(index = 0) {
      const capture = captures[index];
      await act(async () => {
        capture?.started.resolve({ ok: true, value: { stop: jest.fn(), result: capture.result.promise } });
        await Promise.resolve();
      });
    },
    async deliver(index = 0) {
      await act(async () => {
        captures[index]?.result.resolve({ ok: true, value: CLIP });
        await Promise.resolve();
      });
    },
  };
}

function uuidSequence() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

async function renderGate(provider: AuthSessionProvider | undefined, audio?: LocalAudio) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthGate provider={provider} createRequestId={uuidSequence()} audio={audio} />
    </SafeAreaProvider>,
  );
}

const ANA: AuthUser = { uid: "uid-ana", name: "Ana" };
const BRUNO: AuthUser = { uid: "uid-bruno", name: "Bruno" };
const GOOGLE = "Continuar con Google";
const DEMO = "Probar demo local";
const START_A = "Toca para hablar, Español";
const FINISH_A = "Grabando: toca para terminar, Español";

function conversation() {
  return screen.queryByTestId("conversacion");
}

/** Recorre toda la pantalla: ningún texto puede mostrar un código crudo del SDK. */
function expectNoRawCodes() {
  expect(screen.queryByText(/auth\//)).toBeNull();
  expect(screen.queryByText(/POPUP_BLOCKED|NETWORK|SIGN_OUT_FAILED|UNKNOWN/)).toBeNull();
}

describe("AuthGate: entrada", () => {
  it("en nativo (sin proveedor) va directa a la DEMO, sin pantalla de inicio ni acción de sesión", async () => {
    await renderGate(undefined);
    expect(conversation()).toBeOnTheScreen();
    expect(screen.queryByText(GOOGLE)).toBeNull();
    expect(screen.queryByRole("button", { name: /sesión/ })).toBeNull();
  });

  it("mientras comprueba la sesión, Google espera pero la demo local ya se puede probar, y desde ella se puede iniciar sesión", async () => {
    const fake = fakeSession();
    await renderGate(fake.provider);
    expect(screen.getByText("Comprobando sesión…")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: GOOGLE })).toBeDisabled();
    expect(conversation()).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: DEMO }));
    expect(conversation()).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Iniciar sesión con Google" })).toBeEnabled();
  });

  it("si la sesión no se puede leer, explica qué pasa, permite reintentar y la demo sigue disponible", async () => {
    const fake = fakeSession();
    fake.subscribe.mockImplementationOnce(() => {
      throw new Error("configuración rota");
    });
    await renderGate(fake.provider);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo comprobar la sesión. Reintenta o prueba la demo local.");
    expect(screen.getByRole("button", { name: GOOGLE })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(fake.subscribe).toHaveBeenCalledTimes(2);
    await fake.emit(null);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: GOOGLE })).toBeEnabled();
    expect(screen.getByRole("button", { name: DEMO })).toBeEnabled();
  });
});

describe("AuthGate: iniciar sesión", () => {
  it("abre Google con el toque, ignora el doble toque, cancelar vuelve sin aviso y un fallo se explica sin códigos crudos", async () => {
    const fake = fakeSession();
    await renderGate(fake.provider);
    await fake.emit(null);
    await fireEvent.press(screen.getByRole("button", { name: GOOGLE }));
    expect(fake.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Abriendo Google…")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: GOOGLE })).toBeDisabled();
    expect(screen.getByRole("button", { name: DEMO })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: GOOGLE }));
    expect(fake.signInWithGoogle).toHaveBeenCalledTimes(1);

    await fake.settleSignIn({ status: "cancelled" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: GOOGLE })).toBeEnabled();

    await fireEvent.press(screen.getByRole("button", { name: GOOGLE }));
    await fake.settleSignIn({ status: "failed", code: "POPUP_BLOCKED" }, 1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes y vuelve a intentarlo.",
    );
    expectNoRawCodes();
  });

  it("con la sesión iniciada muestra la conversación con «Cerrar sesión» y el nombre, sin cambiar las mitades", async () => {
    const fake = fakeSession();
    await renderGate(fake.provider);
    await fake.emit(ANA);
    expect(conversation()).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cerrar sesión, Ana" })).toBeEnabled();
    expect(screen.getByTestId("mitad-A")).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ flex: 1, transform: [{ rotate: "180deg" }] });

    await fake.emit({ uid: "uid-sin-nombre" });
    expect(screen.getByRole("button", { name: "Cerrar sesión, Cuenta de Google" })).toBeEnabled();
  });

  it("si otra pestaña cambia la cuenta con el popup abierto, el fallo tardío del popup no se muestra", async () => {
    const fake = fakeSession();
    await renderGate(fake.provider);
    await fake.emit(null);
    await fireEvent.press(screen.getByRole("button", { name: GOOGLE }));
    await fake.emit(BRUNO);
    expect(screen.getByRole("button", { name: "Cerrar sesión, Bruno" })).toBeEnabled();
    await fake.settleSignIn({ status: "failed", code: "NETWORK" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar sesión, Bruno" })).toBeEnabled();
  });

  it("iniciar sesión desde la demo con el micrófono pidiéndose desmonta la conversación al momento; cancelar vuelve a una demo nueva", async () => {
    const fake = fakeSession();
    const script = scriptedAudio();
    await renderGate(fake.provider, script.audio);
    await fake.emit(null);
    await fireEvent.press(screen.getByRole("button", { name: DEMO }));
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A }));
    expect(script.captures).toHaveLength(1);

    await fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión con Google" }));
    expect(script.captures[0]?.signal.aborted).toBe(true);
    expect(conversation()).toBeNull();
    expect(screen.getByText("Abriendo Google…")).toBeOnTheScreen();

    await fake.settleSignIn({ status: "cancelled" });
    expect(conversation()).toBeOnTheScreen();
    expect(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un fallo al iniciar sesión desde la demo lleva a la pantalla inicial con el aviso, y la demo se puede retomar", async () => {
    const fake = fakeSession();
    await renderGate(fake.provider);
    await fake.emit(null);
    await fireEvent.press(screen.getByRole("button", { name: DEMO }));
    await fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión con Google" }));
    await fake.settleSignIn({ status: "failed", code: "NETWORK" });
    expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con Google. Revisa tu red y vuelve a intentarlo.");
    await fireEvent.press(screen.getByRole("button", { name: DEMO }));
    expect(conversation()).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AuthGate: cerrar sesión", () => {
  it("cerrar sesión pidiendo el micrófono (PREPARING) o grabando (RECORDING) suelta el micrófono antes de que responda el SDK", async () => {
    const fake = fakeSession();
    const script = scriptedAudio();
    await renderGate(fake.provider, script.audio);
    await fake.emit(ANA);
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A }));
    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión, Ana" }));
    expect(script.captures[0]?.signal.aborted).toBe(true);
    expect(conversation()).toBeNull();
    expect(screen.getByText("Cerrando sesión…")).toBeOnTheScreen();
    expect(fake.signOut).toHaveBeenCalledTimes(1);

    // El cierre falla: vuelve una conversación NUEVA con el aviso, y desde ella se graba otra vez.
    await fake.settleSignOut(false);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cerrar sesión. Vuelve a intentarlo.");
    expect(screen.queryByText("Grabando")).toBeNull();
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A }));
    await script.grant(1);
    expect(within(screen.getByTestId("mitad-A")).getByText("Grabando")).toBeOnTheScreen();

    // Reintentar el cierre quita el aviso y vuelve a soltar el micrófono de la grabación nueva.
    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión, Ana" }));
    expect(script.captures[1]?.signal.aborted).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    await fake.emit(null);
    await fake.settleSignOut(true, 1);
    expect(screen.getByRole("button", { name: GOOGLE })).toBeEnabled();
    expect(conversation()).toBeNull();
    expectNoRawCodes();
  });

  it("cerrar sesión mientras suena el clip lo para; si el cierre falla, el clip anterior no vuelve", async () => {
    const fake = fakeSession();
    const script = scriptedAudio();
    await renderGate(fake.provider, script.audio);
    await fake.emit(ANA);
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A }));
    await script.grant();
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: FINISH_A }));
    await script.deliver();
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: "Escuchar, Español" }));
    expect(script.plays).toHaveLength(1);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión, Ana" }));
    expect(script.plays[0]?.aborted).toBe(true);
    await fake.settleSignOut(false);
    expect(screen.queryByText("Tu audio")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cerrar sesión. Vuelve a intentarlo.");
  });

  it("el mismo uid refrescado conserva la conversación y su clip; otra cuenta empieza una conversación nueva", async () => {
    const fake = fakeSession();
    const script = scriptedAudio();
    await renderGate(fake.provider, script.audio);
    await fake.emit(ANA);
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A }));
    await script.grant();
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: FINISH_A }));
    await script.deliver();
    expect(screen.getByText("Tu audio")).toBeOnTheScreen();

    await fake.emit({ uid: "uid-ana", name: "Ana" });
    expect(screen.getByText("Tu audio")).toBeOnTheScreen();

    await fake.emit(BRUNO);
    expect(screen.queryByText("Tu audio")).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar sesión, Bruno" })).toBeEnabled();
  });

  it("si otra pestaña cierra la sesión mientras se graba, se suelta el micrófono y se vuelve a la pantalla inicial", async () => {
    const fake = fakeSession();
    const script = scriptedAudio();
    await renderGate(fake.provider, script.audio);
    await fake.emit(ANA);
    await fireEvent.press(within(screen.getByTestId("mitad-A")).getByRole("button", { name: START_A }));
    await script.grant();
    await fake.emit(null);
    expect(script.captures[0]?.signal.aborted).toBe(true);
    expect(conversation()).toBeNull();
    expect(screen.getByRole("button", { name: GOOGLE })).toBeEnabled();
  });
});

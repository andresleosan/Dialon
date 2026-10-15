import { act, renderHook } from "@testing-library/react-native";
import type { AuthErrorCode, AuthSessionProvider, AuthUser, SignInOutcome } from "./session";
import { useAuthSession } from "./useAuthSession";

// Proveedor de sesión emulado: el test decide qué cuenta avisa el SDK y cuándo responde el popup o el cierre. Ninguna
// prueba contacta con Firebase ni con Google.

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

function fakeProvider() {
  const listeners: { onUser: (user: AuthUser | null) => void; onError: (code: AuthErrorCode) => void }[] = [];
  const signIns: Deferred<SignInOutcome>[] = [];
  const signOuts: Deferred<undefined>[] = [];
  const unsubscribe = jest.fn();
  const subscribe = jest.fn((onUser: (user: AuthUser | null) => void, onError: (code: AuthErrorCode) => void) => {
    listeners.push({ onUser, onError });
    return unsubscribe;
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
  const last = () => {
    const listener = listeners.at(-1);
    if (!listener) throw new Error("sin suscripción");
    return listener;
  };
  return {
    provider,
    subscribe,
    unsubscribe,
    signInWithGoogle,
    signOut,
    signIns,
    signOuts,
    async emit(user: AuthUser | null) {
      await act(() => {
        last().onUser(user);
      });
    },
    async fail(code: AuthErrorCode) {
      await act(() => {
        last().onError(code);
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
        else signOuts[index]?.reject(new Error("fallo de red interno con datos que no deben verse"));
        await Promise.resolve();
      });
    },
  };
}

const ANA: AuthUser = { uid: "uid-ana", name: "Ana" };
const BRUNO: AuthUser = { uid: "uid-bruno", name: "Bruno" };

async function mount(fake: ReturnType<typeof fakeProvider>) {
  return renderHook(() => useAuthSession(fake.provider));
}

describe("useAuthSession: estado de la sesión", () => {
  it("comprueba hasta el primer aviso del SDK, distingue sin sesión y con sesión, y deja de escuchar al desmontar", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    expect(hook.result.current.user).toBeUndefined();
    await fake.emit(null);
    expect(hook.result.current.user).toBeNull();
    await fake.emit(ANA);
    expect(hook.result.current.user).toEqual(ANA);
    await hook.unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("si suscribirse lanza o el SDK avisa un error, informa sin colgarse y «reintentar» vuelve a suscribirse", async () => {
    const fake = fakeProvider();
    fake.subscribe.mockImplementationOnce(() => {
      throw new Error("configuración rota");
    });
    const hook = await mount(fake);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.failure).toBe("UNKNOWN");
    expect(hook.result.current.user).toBeUndefined();

    await act(() => {
      hook.result.current.retry();
    });
    expect(fake.subscribe).toHaveBeenCalledTimes(2);
    expect(hook.result.current.failure).toBeUndefined();
    await fake.fail("CONFIG");
    expect(hook.result.current.failure).toBe("CONFIG");
    await act(() => {
      hook.result.current.retry();
    });
    await fake.emit(null);
    expect(hook.result.current.failure).toBeUndefined();
    expect(hook.result.current.user).toBeNull();
  });

  it("el mismo uid refrescado conserva el mismo usuario; otro uid lo reemplaza", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(ANA);
    const first = hook.result.current.user;
    await fake.emit({ uid: "uid-ana", name: "Ana" });
    expect(hook.result.current.user).toBe(first);
    await fake.emit(BRUNO);
    expect(hook.result.current.user).toEqual(BRUNO);
  });
});

describe("useAuthSession: iniciar sesión", () => {
  it("abre Google una sola vez aunque se toque dos veces; cancelar vuelve sin aviso", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(null);
    await act(() => {
      hook.result.current.signIn();
      // El popup se abre en el mismo gesto, sin esperar.
      expect(fake.signInWithGoogle).toHaveBeenCalledTimes(1);
      hook.result.current.signIn();
    });
    expect(fake.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(hook.result.current.busy).toBe("signIn");
    await fake.settleSignIn({ status: "cancelled" });
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.error).toBeUndefined();
  });

  it("un fallo deja su código seguro; si el proveedor lanza en el acto, avisa UNKNOWN; clearError lo quita", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(null);
    await act(() => {
      hook.result.current.signIn();
    });
    await fake.settleSignIn({ status: "failed", code: "POPUP_BLOCKED" });
    expect(hook.result.current.error).toBe("POPUP_BLOCKED");
    expect(hook.result.current.busy).toBeUndefined();

    fake.signInWithGoogle.mockImplementationOnce(() => {
      throw new Error("lanzó en el acto");
    });
    await act(async () => {
      hook.result.current.signIn();
      await Promise.resolve();
    });
    expect(hook.result.current.error).toBe("UNKNOWN");
    expect(hook.result.current.busy).toBeUndefined();
    await act(() => {
      hook.result.current.clearError();
    });
    expect(hook.result.current.error).toBeUndefined();
  });

  it("si el SDK avisa otra cuenta mientras el popup sigue abierto, el resultado tardío del popup se ignora", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(null);
    await act(() => {
      hook.result.current.signIn();
    });
    await fake.emit(BRUNO);
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.user).toEqual(BRUNO);
    await fake.settleSignIn({ status: "failed", code: "NETWORK" });
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.user).toEqual(BRUNO);
  });

  it("un resultado que llega tras desmontar no actualiza nada", async () => {
    const fake = fakeProvider();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const hook = await mount(fake);
    await fake.emit(null);
    await act(() => {
      hook.result.current.signIn();
    });
    await hook.unmount();
    await fake.settleSignIn({ status: "failed", code: "NETWORK" });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("useAuthSession: reintentar con un popup pendiente", () => {
  it("si la sesión falla con Google abierto, «reintentar» suelta el popup pendiente y su resultado tardío ya no se aplica", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(null);
    await act(() => {
      hook.result.current.signIn();
    });
    await fake.fail("BROWSER");
    // Explícito: mientras no se reintente, el popup sigue en curso.
    expect(hook.result.current.failure).toBe("BROWSER");
    expect(hook.result.current.busy).toBe("signIn");

    await act(() => {
      hook.result.current.retry();
    });
    expect(fake.subscribe).toHaveBeenCalledTimes(2);
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.failure).toBeUndefined();
    // La suscripción nueva vuelve a avisar la misma ausencia de cuenta: no cambia nada.
    await fake.emit(null);
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.busy).toBeUndefined();

    // Google se puede volver a abrir; el popup viejo, al llegar tarde, no pisa la operación nueva.
    await act(() => {
      hook.result.current.signIn();
    });
    expect(fake.signInWithGoogle).toHaveBeenCalledTimes(2);
    await fake.settleSignIn({ status: "failed", code: "NETWORK" }, 0);
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.busy).toBe("signIn");
    await fake.settleSignIn({ status: "cancelled" }, 1);
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.error).toBeUndefined();
  });
});

describe("useAuthSession: cerrar sesión", () => {
  it("marca el cierre en curso al momento y termina cuando el SDK avisa que no hay sesión", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(ANA);
    await act(() => {
      hook.result.current.signOut();
      hook.result.current.signOut();
    });
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    expect(hook.result.current.busy).toBe("signOut");
    await fake.emit(null);
    await fake.settleSignOut(true);
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.error).toBeUndefined();
  });

  it("si el cierre falla, avisa SIGN_OUT_FAILED y la cuenta sigue; si el SDK ya avisó otra cuenta, no la pisa", async () => {
    const fake = fakeProvider();
    const hook = await mount(fake);
    await fake.emit(ANA);
    await act(() => {
      hook.result.current.signOut();
    });
    await fake.settleSignOut(false);
    expect(hook.result.current.error).toBe("SIGN_OUT_FAILED");
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.user).toEqual(ANA);

    await act(() => {
      hook.result.current.signOut();
    });
    expect(hook.result.current.error).toBeUndefined();
    await fake.emit(BRUNO);
    await fake.settleSignOut(false, 1);
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.busy).toBeUndefined();
    expect(hook.result.current.user).toEqual(BRUNO);
  });
});

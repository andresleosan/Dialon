import type { AuthErrorCode, AuthSessionProvider, AuthUser, IdTokenSource } from "./session";

// SDK de Firebase simulado en su frontera de módulo (`firebase/app`, `firebase/auth`): ninguna prueba contacta con
// Firebase ni con Google. Los códigos `auth/...` son literales del SDK.

const mockSdk = {
  initializeApp: jest.fn((config: unknown) => ({ name: "[DEFAULT]", config })),
  getApps: jest.fn((): unknown[] => []),
  getApp: jest.fn(() => ({ name: "[DEFAULT]" })),
  getAuth: jest.fn((app: unknown) => ({ app })),
  onAuthStateChanged: jest.fn<() => void, [unknown, (user: unknown) => void, ((error: unknown) => void)?]>(() =>
    jest.fn(),
  ),
  signInWithPopup: jest.fn<Promise<unknown>, [unknown, unknown]>(() => Promise.resolve({})),
  signOut: jest.fn<Promise<void>, [unknown]>(() => Promise.resolve()),
  providers: [] as { parameters?: unknown }[],
};

jest.mock("firebase/app", () => ({
  initializeApp: (config: unknown) => mockSdk.initializeApp(config),
  getApps: () => mockSdk.getApps(),
  getApp: () => mockSdk.getApp(),
}));

jest.mock("firebase/auth", () => ({
  getAuth: (app: unknown) => mockSdk.getAuth(app),
  onAuthStateChanged: (auth: unknown, next: (user: unknown) => void, error?: (error: unknown) => void) =>
    mockSdk.onAuthStateChanged(auth, next, error),
  signInWithPopup: (auth: unknown, provider: unknown) => mockSdk.signInWithPopup(auth, provider),
  signOut: (auth: unknown) => mockSdk.signOut(auth),
  GoogleAuthProvider: class {
    parameters?: unknown;
    constructor() {
      mockSdk.providers.push(this);
    }
    setCustomParameters(parameters: unknown) {
      this.parameters = parameters;
      return this;
    }
  },
}));

let firebaseAuth: AuthSessionProvider;

beforeEach(() => {
  // Módulo nuevo en cada prueba (su inicialización perezosa empieza de cero); el SDK sigue simulado.
  jest.resetModules();
  for (const fn of Object.values(mockSdk)) if (typeof fn === "function") (fn as jest.Mock).mockClear();
  mockSdk.providers = [];
  const loaded = jest.requireActual<{ firebaseAuth?: AuthSessionProvider }>("./firebaseAuth.web");
  if (!loaded.firebaseAuth) throw new Error("el adaptador web no exporta un proveedor");
  firebaseAuth = loaded.firebaseAuth;
});

function listen() {
  const users: (AuthUser | null)[] = [];
  const errors: AuthErrorCode[] = [];
  const stop = firebaseAuth.subscribe(
    (user) => users.push(user),
    (code) => errors.push(code),
  );
  return { users, errors, stop };
}

function sdkListener() {
  const call = mockSdk.onAuthStateChanged.mock.calls.at(-1);
  if (!call) throw new Error("el adaptador no escuchó al SDK");
  return { next: call[1], error: call[2] };
}

function authError(code: string) {
  return Object.assign(new Error(`Firebase: Error (${code}). ana@example.com`), { code, customData: { email: "ana@example.com" } });
}

describe("firebaseAuth (web): inicialización", () => {
  it("importar no llama al SDK; el primer uso inicializa una sola vez con los cuatro campos públicos", () => {
    expect(mockSdk.initializeApp).not.toHaveBeenCalled();
    expect(mockSdk.getAuth).not.toHaveBeenCalled();
    listen();
    listen();
    expect(mockSdk.initializeApp).toHaveBeenCalledTimes(1);
    const [config] = mockSdk.initializeApp.mock.calls[0] ?? [];
    expect(Object.keys(config as object).sort()).toEqual(["apiKey", "appId", "authDomain", "projectId"]);
    expect(config).toMatchObject({ authDomain: "dialonapp.firebaseapp.com", projectId: "dialonapp" });
    expect(mockSdk.getAuth).toHaveBeenCalledTimes(1);
  });

  it("si inicializar lanza, suscribirse no lanza y avisa CONFIG; Google y cerrar sesión fallan sin lanzar en el acto", async () => {
    mockSdk.initializeApp.mockImplementationOnce(() => {
      throw new Error("invalid-api-key");
    });
    const session = listen();
    expect(session.errors).toEqual([]);
    await Promise.resolve();
    expect(session.errors).toEqual(["CONFIG"]);
    expect(() => {
      session.stop();
    }).not.toThrow();

    mockSdk.initializeApp.mockImplementationOnce(() => {
      throw new Error("invalid-api-key");
    });
    await expect(firebaseAuth.signInWithGoogle()).resolves.toStrictEqual({ status: "failed", code: "CONFIG" });
    mockSdk.initializeApp.mockImplementationOnce(() => {
      throw new Error("invalid-api-key");
    });
    await expect(firebaseAuth.signOut()).rejects.toBeInstanceOf(Error);
  });

  it("si escuchar al SDK lanza, avisa UNKNOWN; un error que avisa el SDK llega con su código seguro", async () => {
    mockSdk.onAuthStateChanged.mockImplementationOnce(() => {
      throw new Error("roto");
    });
    const broken = listen();
    await Promise.resolve();
    expect(broken.errors).toEqual(["UNKNOWN"]);

    const session = listen();
    sdkListener().error?.(authError("auth/network-request-failed"));
    expect(session.errors).toEqual(["NETWORK"]);
  });
});

describe("firebaseAuth (web): cuenta", () => {
  it("entrega solo uid y nombre visible; sin nombre no usa el correo; y deja de escuchar con la función del SDK", () => {
    const unsubscribe = jest.fn();
    mockSdk.onAuthStateChanged.mockReturnValueOnce(unsubscribe);
    const session = listen();
    const { next } = sdkListener();
    next({
      uid: "uid-ana",
      displayName: "  Ana López ",
      email: "ana@example.com",
      accessToken: "token-secreto",
      getIdToken: jest.fn(),
    });
    next({ uid: "uid-bruno", displayName: null, email: "bruno@example.com" });
    next(null);
    expect(session.users).toStrictEqual([{ uid: "uid-ana", name: "Ana López" }, { uid: "uid-bruno" }, null]);
    session.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("firebaseAuth (web): Google", () => {
  it("abre el popup en el acto (sin esperar) con selector de cuenta y no devuelve credenciales", async () => {
    mockSdk.signInWithPopup.mockResolvedValueOnce({ user: { uid: "uid-ana" }, _tokenResponse: { idToken: "secreto" } });
    const pending = firebaseAuth.signInWithGoogle();
    expect(mockSdk.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mockSdk.providers).toHaveLength(1);
    expect(mockSdk.providers[0]?.parameters).toEqual({ prompt: "select_account" });
    await expect(pending).resolves.toStrictEqual({ status: "ok" });
  });

  it("traduce los códigos del SDK a resultados seguros, sin texto crudo ni correo", async () => {
    const cases: [unknown, unknown][] = [
      [authError("auth/popup-closed-by-user"), { status: "cancelled" }],
      [authError("auth/cancelled-popup-request"), { status: "cancelled" }],
      [authError("auth/user-cancelled"), { status: "cancelled" }],
      [authError("auth/popup-blocked"), { status: "failed", code: "POPUP_BLOCKED" }],
      [authError("auth/network-request-failed"), { status: "failed", code: "NETWORK" }],
      [authError("auth/unauthorized-domain"), { status: "failed", code: "CONFIG" }],
      [authError("auth/operation-not-allowed"), { status: "failed", code: "CONFIG" }],
      [authError("auth/invalid-api-key"), { status: "failed", code: "CONFIG" }],
      [authError("auth/api-key-not-valid.-please-pass-a-valid-api-key."), { status: "failed", code: "CONFIG" }],
      [authError("auth/configuration-not-found"), { status: "failed", code: "CONFIG" }],
      [authError("auth/too-many-requests"), { status: "failed", code: "RATE_LIMITED" }],
      [authError("auth/user-disabled"), { status: "failed", code: "ACCOUNT_DISABLED" }],
      [authError("auth/web-storage-unsupported"), { status: "failed", code: "BROWSER" }],
      [authError("auth/operation-not-supported-in-this-environment"), { status: "failed", code: "BROWSER" }],
      [authError("auth/internal-error"), { status: "failed", code: "UNKNOWN" }],
      ["no es un error", { status: "failed", code: "UNKNOWN" }],
    ];
    for (const [error, outcome] of cases) {
      mockSdk.signInWithPopup.mockRejectedValueOnce(error);
      await expect(firebaseAuth.signInWithGoogle()).resolves.toStrictEqual(outcome);
    }
    mockSdk.signInWithPopup.mockImplementationOnce(() => {
      throw authError("auth/popup-blocked");
    });
    await expect(firebaseAuth.signInWithGoogle()).resolves.toStrictEqual({ status: "failed", code: "POPUP_BLOCKED" });
  });

  it("cerrar sesión delega en el SDK y propaga su fallo como rechazo", async () => {
    await expect(firebaseAuth.signOut()).resolves.toBeUndefined();
    expect(mockSdk.signOut).toHaveBeenCalledTimes(1);
    mockSdk.signOut.mockRejectedValueOnce(authError("auth/network-request-failed"));
    await expect(firebaseAuth.signOut()).rejects.toBeInstanceOf(Error);
  });
});

describe("firebaseAuth (web): ID token para llamadas protegidas", () => {
  interface FakeUser {
    uid: string;
    getIdToken: jest.Mock<Promise<string>, []>;
  }

  function tokenSource() {
    const loaded = jest.requireActual<{ firebaseAuth?: AuthSessionProvider & IdTokenSource }>("./firebaseAuth.web");
    if (!loaded.firebaseAuth) throw new Error("sin proveedor");
    return loaded.firebaseAuth;
  }

  function signedIn(user: FakeUser | null) {
    const auth: { currentUser: FakeUser | null } = { currentUser: user };
    mockSdk.getAuth.mockReturnValueOnce(auth as never);
    return auth;
  }

  function fakeUser(uid: string, token: Promise<string>): FakeUser {
    return { uid, getIdToken: jest.fn(() => token) };
  }

  it("sin cuenta devuelve null; con cuenta devuelve el token que da el SDK", async () => {
    signedIn(null);
    await expect(tokenSource().getIdToken()).resolves.toBeNull();
    jest.resetModules();
    const ana = fakeUser("uid-ana", Promise.resolve("token-ana"));
    signedIn(ana);
    await expect(tokenSource().getIdToken()).resolves.toBe("token-ana");
    expect(ana.getIdToken).toHaveBeenCalledTimes(1);
  });

  it("si la cuenta cambia o se cierra mientras se pide el token, devuelve null y no el token de la cuenta anterior", async () => {
    let resolveToken!: (token: string) => void;
    const ana = fakeUser("uid-ana", new Promise<string>((resolve) => (resolveToken = resolve)));
    const auth = signedIn(ana);
    const pending = tokenSource().getIdToken();
    auth.currentUser = fakeUser("uid-bruno", Promise.resolve("token-bruno"));
    resolveToken("token-ana");
    await expect(pending).resolves.toBeNull();

    jest.resetModules();
    let resolveSecond!: (token: string) => void;
    const again = fakeUser("uid-ana", new Promise<string>((resolve) => (resolveSecond = resolve)));
    const second = signedIn(again);
    const signingOut = tokenSource().getIdToken();
    second.currentUser = null;
    resolveSecond("token-ana");
    await expect(signingOut).resolves.toBeNull();
  });

  it("un error del SDK o de la inicialización devuelve null sin lanzar ni filtrar el error", async () => {
    signedIn({ uid: "uid-ana", getIdToken: jest.fn(() => Promise.reject(new Error("auth/network-request-failed ana@example.com"))) });
    await expect(tokenSource().getIdToken()).resolves.toBeNull();
    jest.resetModules();
    mockSdk.initializeApp.mockImplementationOnce(() => {
      throw new Error("invalid-api-key");
    });
    await expect(tokenSource().getIdToken()).resolves.toBeNull();
  });
});

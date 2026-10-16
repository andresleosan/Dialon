import type {
  AdminPaymentRequestView,
  AdminSettings,
  AdminStatus,
  MeResponse,
  PaymentRequestView,
  PublicPayments,
} from "@dialon/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AuthSessionProvider, AuthUser } from "../auth/session";
import { AuthGate } from "../screens/AuthGate";
import type { ApiClient } from "./api";
import type { PanelName, PanelRoute } from "./panelRoute";

// Puerta real + paneles reales. Solo se emulan los efectos externos: la sesión (proveedor inyectado), el API (cliente
// inyectado con respuestas ya validadas), la URL (`?panel=`) y el selector de archivos del navegador. Datos ficticios:
// nada contacta con Firebase, con el Worker ni con un proveedor.

const mockFile = { data: { size: 1234 }, type: "application/pdf", name: "comprobante-prueba.pdf", bytes: 1234 };

jest.mock("./ReceiptPicker", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ReceiptPicker: ({ disabled, onPick }: { disabled: boolean; onPick: (file: unknown) => void }) =>
      createElement(
        Pressable,
        { role: "button", "aria-label": "Elegir comprobante de prueba", disabled, onPress: () => { onPick(mockFile); } },
        createElement(Text, null, "Elegir comprobante de prueba"),
      ),
  };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const ANA: AuthUser = { uid: "uid-ana", name: "Ana" };
const ID = "1b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
// Catálogo por país.
const OFF: PublicPayments = { enabled: false, markets: [] };
const ON: PublicPayments = {
  enabled: true,
  markets: [
    {
      country: "JE",
      currency: "GBP",
      instructions: "CUENTA FICTICIA DE PRUEBA",
      plans: [
        { plan: "weekly", days: 7, amountMinor: 500, limits: { maxRequests: 20, maxChars: 4000 } },
        { plan: "biweekly", days: 14, amountMinor: 900, limits: { maxRequests: 40, maxChars: 8000 } },
        { plan: "monthly", days: 30, amountMinor: 1500, limits: { maxRequests: 90, maxChars: 18000 } },
      ],
    },
  ],
};

function me(role: "owner" | "user", payments: PublicPayments = OFF): MeResponse {
  return {
    uid: ANA.uid,
    role,
    subscription: { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } },
    payments,
  };
}

const PENDING: PaymentRequestView = {
  id: ID,
  country: "JE",
  plan: "weekly",
  days: 7,
  amountMinor: 500,
  currency: "GBP",
  limits: { maxRequests: 20, maxChars: 4000 },
  status: "pending",
  createdAt: Date.UTC(2026, 9, 16),
  decidedAt: null,
  receipt: null,
};
const WITH_RECEIPT: PaymentRequestView = {
  ...PENDING,
  receipt: { type: "application/pdf", bytes: 1234, uploadedAt: Date.UTC(2026, 9, 16), expiresAt: Date.UTC(2027, 0, 14), available: true },
};
const ADMIN_REQUEST: AdminPaymentRequestView = { ...WITH_RECEIPT, uid: "uid-bea", email: "bea@example.com" };
const SETTINGS: AdminSettings = {
  translation: { activeProvider: "sarin", externalProvidersEnabled: false },
  payments: { enabled: false, markets: [] },
};
const STATUS: AdminStatus = {
  activeProvider: "sarin",
  providers: {
    sarin: { configured: true, state: "verified", lastSuccessAt: Date.UTC(2026, 9, 15), lastFailureAt: null },
    deepseek: { configured: true, state: "unverified", lastSuccessAt: null, lastFailureAt: null },
  },
};

function ok<T>(value: T) {
  return jest.fn<Promise<{ readonly ok: true; readonly value: T }>, unknown[]>(() => Promise.resolve({ ok: true as const, value }));
}

function fakeApi(account: MeResponse, overrides: Record<string, jest.Mock> = {}) {
  const mocks = {
    translateText: jest.fn(),
    getMe: ok(account),
    listMyPaymentRequests: ok({ requests: [] as PaymentRequestView[], nextCursor: null }),
    createPaymentRequest: ok(PENDING),
    uploadReceipt: ok(WITH_RECEIPT),
    downloadMyReceipt: jest.fn(),
    listUsers: ok({ users: [], nextCursor: null }),
    updateSubscription: jest.fn(),
    getSettings: ok(SETTINGS),
    updateSettings: jest.fn(),
    getStatus: ok(STATUS),
    listPaymentRequests: ok({ requests: [ADMIN_REQUEST], nextCursor: null }),
    downloadReceiptAsOwner: jest.fn(),
    approvePaymentRequest: ok({ ...ADMIN_REQUEST, status: "approved", decidedAt: Date.UTC(2026, 9, 17) }),
    rejectPaymentRequest: jest.fn(),
    ...overrides,
  };
  return { mocks, api: mocks as unknown as ApiClient };
}

function fakeSession() {
  const listeners: ((user: AuthUser | null) => void)[] = [];
  const signOut = jest.fn(() => new Promise<void>(() => undefined));
  const provider: AuthSessionProvider = {
    subscribe: (onUser: (user: AuthUser | null) => void) => {
      listeners.push(onUser);
      return () => undefined;
    },
    signInWithGoogle: () => Promise.resolve({ status: "ok" }),
    signOut,
  };
  return {
    provider,
    signOut,
    async emit(user: AuthUser | null) {
      await act(() => {
        listeners.at(-1)?.(user);
      });
    },
  };
}

function fakeRoute(initial: PanelName | undefined): PanelRoute & { write: jest.Mock } {
  return { read: () => initial, write: jest.fn(), subscribe: () => () => undefined };
}

let ids = 0;
const createId = () => {
  ids += 1;
  return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
};

async function open(panel: PanelName | undefined, api: ApiClient | undefined) {
  const session = fakeSession();
  const route = fakeRoute(panel);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthGate provider={session.provider} createRequestId={createId} api={api} panelRoute={route} />
    </SafeAreaProvider>,
  );
  await session.emit(ANA);
  return { session, route };
}

describe("cuenta: rutas y rol del backend", () => {
  it("sin ?panel la conversación no cambia y no se pide nada al API", async () => {
    const { api, mocks } = fakeApi(me("owner"));
    await open(undefined, api);
    expect(screen.getByTestId("conversacion")).toBeOnTheScreen();
    expect(mocks.getMe).not.toHaveBeenCalled();
  });

  it("sin API configurada lo explica, sin rol inventado ni paneles", async () => {
    await open("admin", undefined);
    expect(screen.getByText(/El servicio de cuentas no está configurado/)).toBeOnTheScreen();
    expect(screen.queryByRole("heading", { name: "Administración" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Mi suscripción" })).toBeNull();
  });

  it("?panel=admin con una cuenta normal según el backend: sin administración ni peticiones de administración", async () => {
    const { api, mocks } = fakeApi(me("user"));
    await open("admin", api);
    expect(await screen.findByText("No tienes acceso a la administración.")).toBeOnTheScreen();
    expect(screen.queryByRole("heading", { name: "Administración" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Administración" })).toBeNull();
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("navegar escribe la URL; «Conversación» vuelve a la DEMO", async () => {
    const { api } = fakeApi(me("user"));
    const { route } = await open("subscription", api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    await fireEvent.press(screen.getByRole("button", { name: "Conversación" }));
    expect((route.write as jest.Mock).mock.calls).toEqual([[undefined]]);
    expect(screen.getByTestId("conversacion")).toBeOnTheScreen();
  });

  it("cerrar sesión desmonta la cuenta y cancela la petición en curso", async () => {
    let signal: AbortSignal | undefined;
    const { api } = fakeApi(me("user"), {
      getMe: jest.fn((received: AbortSignal) => {
        signal = received;
        return new Promise(() => undefined);
      }),
    });
    const { session } = await open("subscription", api);
    expect(screen.getByText("Cargando tu cuenta…")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión, Ana" }));
    expect(session.signOut).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId("cuenta")).toBeNull();
  });
});

describe("Mi suscripción", () => {
  it("con pagos desactivados lo explica y no ofrece solicitar", async () => {
    const { api } = fakeApi(me("user"));
    await open("subscription", api);
    expect(await screen.findByRole("heading", { name: "Mi suscripción" })).toBeOnTheScreen();
    expect(screen.getByText("Estado: Inactiva")).toBeOnTheScreen();
    expect(screen.getByText("Las solicitudes de suscripción no están disponibles por ahora.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Solicitar suscripción" })).toBeNull();
  });

  it("solicita con el país elegido, el plan y el importe del propietario; tras un fallo de red reintenta con la MISMA clave", async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "NETWORK", detail: "sin conexión" })
      .mockResolvedValueOnce({ ok: true, value: PENDING });
    const { api } = fakeApi(me("user", ON), { createPaymentRequest: create });
    await open("subscription", api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    await fireEvent.press(screen.getByRole("radio", { name: "Jersey (JE)" }));
    expect(screen.getByText("CUENTA FICTICIA DE PRUEBA")).toBeOnTheScreen();
    const weekly = screen.getByRole("radio", { name: /^Semanal: 7 días · 5,00 GBP/ });
    expect(screen.getByRole("button", { name: "Solicitar suscripción" })).toBeDisabled();

    await fireEvent.press(weekly);
    await fireEvent.press(screen.getByRole("button", { name: "Solicitar suscripción" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Sin conexión con el servicio/);
    await fireEvent.press(screen.getByRole("button", { name: "Solicitar suscripción" }));
    await screen.findByText(/Solicitud creada/);

    const [first, second] = create.mock.calls.map(([body]: unknown[]) => body as { country: string; plan: string; idempotencyKey: string });
    expect(first?.country).toBe("JE");
    expect(first?.plan).toBe("weekly");
    expect(first?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(first ?? {}).sort()).toEqual(["country", "idempotencyKey", "plan"]);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(screen.getByText("Estado: Pendiente de revisión")).toBeOnTheScreen();
    expect(screen.queryByText("Estado: Activa")).toBeNull();
  });

  it("sube el comprobante elegido de la solicitud pendiente y explica que nada se activa hasta la aprobación", async () => {
    const { api, mocks } = fakeApi(me("user", ON), { listMyPaymentRequests: ok({ requests: [PENDING], nextCursor: null }) });
    await open("subscription", api);
    await screen.findByText("Estado: Pendiente de revisión");
    expect(screen.getByText(/Ya tienes una solicitud pendiente/)).toBeOnTheScreen();
    // Sin prometer borrados de una pendiente: se conserva durante la revisión; los 90 días cuentan tras resolverla.
    expect(screen.getByText(/Se conserva mientras la solicitud está en revisión; una vez aprobada o rechazada/)).toBeOnTheScreen();
    expect(screen.queryByText(/se borra/)).toBeNull();
    expect(screen.getByRole("button", { name: "Subir comprobante" })).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Elegir comprobante de prueba" }));
    await fireEvent.press(screen.getByRole("button", { name: "Subir comprobante" }));
    expect(await screen.findByText(/hasta su aprobación no se activa nada/)).toBeOnTheScreen();
    expect(screen.getByText(/se conserva mientras la solicitud esté en revisión/)).toBeOnTheScreen();
    expect(mocks.uploadReceipt).toHaveBeenCalledWith(ID, { data: mockFile.data, type: "application/pdf" }, expect.any(Object));
    expect(screen.getByRole("button", { name: "Descargar mi comprobante" })).toBeEnabled();
    await fireEvent.press(screen.getByRole("button", { name: "Actualizar" }));
    expect(screen.queryByText(/hasta su aprobación no se activa nada/)).toBeNull();
  });
});

describe("Administración", () => {
  it("el propietario según el backend la ve; el estado de proveedores es histórico y entrar no traduce nada", async () => {
    const { api, mocks } = fakeApi(me("owner"));
    await open("admin", api);
    expect(await screen.findByRole("heading", { name: "Administración" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Administración" })).toBeOnTheScreen();
    expect(await screen.findByText("Registro: Respuesta válida registrada")).toBeOnTheScreen();
    expect(screen.getByText("Registro: Sin prueba registrada")).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "DeepSeek (proveedor externo)" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Aceptar solicitudes por transferencia" })).not.toBeChecked();
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
    expect(mocks.translateText).not.toHaveBeenCalled();
  });

  it("aprobar exige confirmación explícita; nunca se aprueba solo", async () => {
    const { api, mocks } = fakeApi(me("owner"));
    await open("admin", api);
    await screen.findByTestId(`solicitud-admin-${ID}`);
    await fireEvent.press(screen.getByRole("button", { name: "Aprobar solicitud de bea@example.com" }));
    expect(mocks.approvePaymentRequest).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Confirmar aprobación" }));
    expect(await screen.findByText(/Solicitud aprobada/)).toBeOnTheScreen();
    expect(mocks.approvePaymentRequest).toHaveBeenCalledTimes(1);
    expect(mocks.approvePaymentRequest).toHaveBeenCalledWith(ID, expect.any(Object));
    expect(screen.queryByTestId(`solicitud-admin-${ID}`)).toBeNull();
    expect(screen.getByText("No hay solicitudes en esta lista.")).toBeOnTheScreen();
  });

  it("activar pagos sin precios ni cuotas no se envía", async () => {
    const { api, mocks } = fakeApi(me("owner"));
    await open("admin", api);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Aceptar solicitudes por transferencia" }));
    await fireEvent.press(screen.getByRole("button", { name: "Guardar pagos" }));
    expect(screen.getByText(/hace falta al menos un país con moneda, instrucciones y precio y cuota/)).toBeOnTheScreen();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

import type { AdminPaymentRequestView, AdminSettings, MeResponse, PaymentRequestView } from "@dialon/contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AuthSessionProvider, AuthUser } from "../auth/session";
import { AuthGate } from "../screens/AuthGate";
import type { ApiClient } from "./api";
import type { PanelName, PanelRoute } from "./panelRoute";

// País y moneda en los paneles reales. Solo se emulan la sesión, el API (respuestas ya validadas), la URL y los idiomas
// del navegador (`navigator.languages`, la única pista de país, y solo como sugerencia). Mercados, importes e
// instrucciones FICTICIOS.

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const ANA: AuthUser = { uid: "uid-ana", name: "Ana" };
const ID = "1b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const LIMITS = { maxRequests: 20, maxChars: 4000 };

function plans(weekly: number, biweekly: number, monthly: number) {
  return [
    { plan: "weekly", days: 7, amountMinor: weekly, limits: LIMITS },
    { plan: "biweekly", days: 14, amountMinor: biweekly, limits: LIMITS },
    { plan: "monthly", days: 30, amountMinor: monthly, limits: LIMITS },
  ];
}

const CATALOG = {
  enabled: true,
  markets: [
    { country: "CO", currency: "COP", instructions: "CUENTA FICTICIA CO", plans: plans(5_000_000, 9_000_000, 15_000_000) },
    { country: "JE", currency: "GBP", instructions: "CUENTA FICTICIA JE", plans: plans(500, 900, 1500) },
  ],
};

function me(role: "owner" | "user", payments: unknown = CATALOG): MeResponse {
  return {
    uid: ANA.uid,
    role,
    subscription: { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } },
    payments,
  } as MeResponse;
}

const CO_REQUEST = {
  id: ID,
  country: "CO",
  plan: "weekly",
  days: 7,
  amountMinor: 5_000_000,
  currency: "COP",
  limits: LIMITS,
  status: "rejected",
  createdAt: Date.UTC(2026, 9, 16),
  decidedAt: Date.UTC(2026, 9, 17),
  receipt: null,
} as unknown as PaymentRequestView;

const MARKET_LIMITS = { weekly: LIMITS, biweekly: LIMITS, monthly: LIMITS };
const CO_MARKET = {
  country: "CO",
  currency: "COP",
  instructions: "TRANSFERENCIA FICTICIA CO",
  prices: { weekly: 5_000_000, biweekly: 9_000_000, monthly: 15_000_000 },
  planLimits: MARKET_LIMITS,
};

function adminSettings(markets: unknown[], enabled = false): AdminSettings {
  return {
    translation: { activeProvider: "sarin", externalProvidersEnabled: false },
    payments: { enabled, markets },
  } as unknown as AdminSettings;
}

function ok<T>(value: T) {
  return jest.fn<Promise<{ readonly ok: true; readonly value: T }>, unknown[]>(() => Promise.resolve({ ok: true as const, value }));
}

function fakeApi(account: MeResponse, overrides: Record<string, jest.Mock> = {}) {
  const mocks = {
    translateText: jest.fn(),
    getMe: ok(account),
    listMyPaymentRequests: ok({ requests: [] as PaymentRequestView[], nextCursor: null }),
    createPaymentRequest: ok(CO_REQUEST),
    uploadReceipt: jest.fn(),
    downloadMyReceipt: jest.fn(),
    listUsers: ok({ users: [], nextCursor: null }),
    updateSubscription: jest.fn(),
    getSettings: ok(adminSettings([])),
    updateSettings: jest.fn((update: { payments: unknown }) =>
      Promise.resolve({ ok: true as const, value: { translation: { activeProvider: "sarin", externalProvidersEnabled: false }, payments: update.payments } }),
    ),
    getStatus: ok({
      activeProvider: "sarin",
      providers: {
        sarin: { configured: false, state: "not_configured", lastSuccessAt: null, lastFailureAt: null },
        deepseek: { configured: false, state: "not_configured", lastSuccessAt: null, lastFailureAt: null },
      },
    }),
    listPaymentRequests: ok({ requests: [] as AdminPaymentRequestView[], nextCursor: null }),
    downloadReceiptAsOwner: jest.fn(),
    approvePaymentRequest: jest.fn(),
    rejectPaymentRequest: jest.fn(),
    ...overrides,
  };
  return { mocks, api: mocks as unknown as ApiClient };
}

function fakeSession() {
  const listeners: ((user: AuthUser | null) => void)[] = [];
  const provider: AuthSessionProvider = {
    subscribe: (onUser: (user: AuthUser | null) => void) => {
      listeners.push(onUser);
      return () => undefined;
    },
    signInWithGoogle: () => Promise.resolve({ status: "ok" }),
    signOut: () => new Promise<void>(() => undefined),
  };
  return {
    provider,
    async emit(user: AuthUser | null) {
      await act(() => {
        listeners.at(-1)?.(user);
      });
    },
  };
}

function route(initial: PanelName): PanelRoute {
  return { read: () => initial, write: jest.fn(), subscribe: () => () => undefined };
}

let ids = 0;
const createId = () => {
  ids += 1;
  return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
};

/** Idiomas del navegador: la única fuente de la SUGERENCIA de país. */
const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
function setLanguages(languages: readonly string[]) {
  Object.defineProperty(globalThis, "navigator", { value: { ...(originalNavigator as object | undefined), languages }, configurable: true, writable: true });
}
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true, writable: true });
});

async function open(panel: PanelName, api: ApiClient) {
  const session = fakeSession();
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthGate provider={session.provider} createRequestId={createId} api={api} panelRoute={route(panel)} />
    </SafeAreaProvider>,
  );
  await session.emit(ANA);
}

const SUGGESTION = /Tu dispositivo sugiere/;
const NO_PRICE = "Todavía no hay tarifa para este país.";

describe("Mi suscripción: país elegido explícitamente", () => {
  it("es-CO solo sugiere Colombia: nada se preselecciona ni se ofrece hasta elegir", async () => {
    setLanguages(["es-CO"]);
    await open("subscription", fakeApi(me("user")).api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    expect(screen.getByText("Tu dispositivo sugiere Colombia (CO). Elige tu país para ver las tarifas.")).toBeOnTheScreen();
    const group = screen.getByRole("radiogroup", { name: "País" });
    for (const name of ["Colombia (CO)", "Jersey (JE)", "Otro país"]) expect(within(group).getByRole("radio", { name })).not.toBeChecked();
    expect(screen.queryByRole("radio", { name: /^Semanal/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Solicitar suscripción" })).toBeNull();
    expect(screen.queryByText("CUENTA FICTICIA CO")).toBeNull();
  });

  it("al elegir país se ven su moneda (código COP/GBP) e instrucciones; cambiar de país limpia el plan elegido", async () => {
    setLanguages(["es-CO"]);
    const { api, mocks } = fakeApi(me("user"));
    await open("subscription", api);
    await screen.findByRole("heading", { name: "Mi suscripción" });

    await fireEvent.press(screen.getByRole("radio", { name: "Colombia (CO)" }));
    expect(screen.getByRole("radio", { name: "Colombia (CO)" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Semanal: 7 días · .*COP/ })).toBeOnTheScreen();
    expect(screen.getByText("CUENTA FICTICIA CO")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: /^Semanal/ }));
    expect(screen.getByRole("button", { name: "Solicitar suscripción" })).toBeEnabled();

    await fireEvent.press(screen.getByRole("radio", { name: "Jersey (JE)" }));
    expect(screen.queryByText("CUENTA FICTICIA CO")).toBeNull();
    expect(screen.getByText("CUENTA FICTICIA JE")).toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: /COP/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^Semanal: 7 días · 5,00 GBP/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Solicitar suscripción" })).toBeDisabled();

    await fireEvent.press(screen.getByRole("radio", { name: /^Mensual: 30 días · 15,00 GBP/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Solicitar suscripción" }));
    expect(mocks.createPaymentRequest).toHaveBeenCalledTimes(1);
    const [body] = mocks.createPaymentRequest.mock.calls[0] ?? [];
    expect(body).toEqual({ country: "JE", plan: "monthly", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown });
  });

  it("idiomas ambiguos (es, es-419, en) no suponen ningún país", async () => {
    setLanguages(["es", "es-419", "en"]);
    await open("subscription", fakeApi(me("user")).api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    expect(screen.getByText("Elige tu país para ver las tarifas.")).toBeOnTheScreen();
    expect(screen.queryByText(SUGGESTION)).toBeNull();
    const group = screen.getByRole("radiogroup", { name: "País" });
    for (const radio of within(group).getAllByRole("radio")) expect(radio).not.toBeChecked();
  });

  it("en-GB sugiere Reino Unido (GB), no Jersey; sin tarifa para GB no hay oferta ni solicitud", async () => {
    setLanguages(["en-GB"]);
    const { api, mocks } = fakeApi(me("user"));
    await open("subscription", api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    const suggestion = screen.getByText(SUGGESTION);
    expect(suggestion).toHaveTextContent(/\(GB\)/);
    expect(suggestion).not.toHaveTextContent(/Jersey/);
    expect(screen.getByRole("radio", { name: "Jersey (JE)" })).not.toBeChecked();

    await fireEvent.press(screen.getByRole("radio", { name: /\(GB\)$/ }));
    expect(screen.getByText(NO_PRICE)).toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: /^Semanal/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Solicitar suscripción" })).toBeNull();
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });

  it("«Otro país» se puede elegir para corregir la sugerencia: sin tarifa, lo explica y no ofrece nada", async () => {
    setLanguages(["es-CO"]);
    await open("subscription", fakeApi(me("user")).api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    await fireEvent.press(screen.getByRole("radio", { name: "Colombia (CO)" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Otro país" }));
    expect(screen.getByRole("radio", { name: "Otro país" })).toBeChecked();
    expect(screen.getByText(NO_PRICE)).toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: /^Semanal/ })).toBeNull();
  });

  it("cambiar de país no altera las solicitudes guardadas; el historial sin país se etiqueta así", async () => {
    setLanguages([]);
    const legacy = { ...CO_REQUEST, id: "2b0f6c5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b", country: null, currency: "EUR", amountMinor: 100 };
    const { api } = fakeApi(me("user"), { listMyPaymentRequests: ok({ requests: [CO_REQUEST, legacy], nextCursor: null }) });
    await open("subscription", api);
    const saved = await screen.findByTestId(`solicitud-${ID}`);
    expect(within(saved).getByText("País: Colombia (CO)")).toBeOnTheScreen();
    expect(within(saved).getByText(/COP/)).toBeOnTheScreen();
    expect(within(screen.getByTestId(`solicitud-${legacy.id}`)).getByText("País: Sin país registrado")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("radio", { name: "Jersey (JE)" }));
    const after = screen.getByTestId(`solicitud-${ID}`);
    expect(within(after).getByText("País: Colombia (CO)")).toBeOnTheScreen();
    expect(within(after).getByText(/COP/)).toBeOnTheScreen();
    expect(within(after).queryByText(/GBP/)).toBeNull();
  });

  it("con pagos apagados no hay selector ni oferta", async () => {
    setLanguages(["es-CO"]);
    await open("subscription", fakeApi(me("user", { enabled: false, markets: [] })).api);
    await screen.findByRole("heading", { name: "Mi suscripción" });
    expect(screen.getByText("Las solicitudes de suscripción no están disponibles por ahora.")).toBeOnTheScreen();
    expect(screen.queryByRole("radiogroup", { name: "País" })).toBeNull();
  });
});

describe("Administración: mercados por país", () => {
  const field = (label: string) => screen.getByLabelText(label);
  const PRICE = (plan: string, n: number) => `Precio ${plan} del mercado ${String(n)} (unidad mayor)`;
  const COUNTRY = (n: number) => `País del mercado ${String(n)} (código de 2 letras)`;
  const CURRENCY = (n: number) => `Moneda del mercado ${String(n)} (código ISO, p. ej. COP)`;
  const INSTRUCTIONS = (n: number) => `Instrucciones del mercado ${String(n)}`;
  const REQUESTS = (plan: string, n: number) => `Peticiones por periodo, plan ${plan}, mercado ${String(n)}`;
  const CHARS = (plan: string, n: number) => `Caracteres por periodo, plan ${plan}, mercado ${String(n)}`;
  const PLANS = ["semanal", "quincenal", "mensual"];

  it("muestra cada mercado con importes en unidad mayor según su moneda; añadir país empieza vacío, sin clonar tarifa ni instrucciones", async () => {
    const { api } = fakeApi(me("owner"), { getSettings: ok(adminSettings([CO_MARKET], true)) });
    await open("admin", api);
    await screen.findByRole("heading", { name: "Administración" });
    expect(await screen.findByLabelText(COUNTRY(1))).toHaveDisplayValue("CO");
    expect(field(CURRENCY(1))).toHaveDisplayValue("COP");
    expect(field(PRICE("semanal", 1))).toHaveDisplayValue("50000.00");
    expect(field(PRICE("mensual", 1))).toHaveDisplayValue("150000.00");
    expect(field(INSTRUCTIONS(1))).toHaveDisplayValue("TRANSFERENCIA FICTICIA CO");

    await fireEvent.press(screen.getByRole("button", { name: "Añadir país" }));
    for (const label of [COUNTRY(2), CURRENCY(2), INSTRUCTIONS(2), ...PLANS.flatMap((plan) => [PRICE(plan, 2), REQUESTS(plan, 2), CHARS(plan, 2)])]) {
      expect(field(label)).toHaveDisplayValue("");
    }
  });

  it("cambiar la moneda de un mercado vacía sus precios para introducirlos de nuevo", async () => {
    const { api, mocks } = fakeApi(me("owner"), { getSettings: ok(adminSettings([CO_MARKET], true)) });
    await open("admin", api);
    await screen.findByLabelText(CURRENCY(1));
    await fireEvent.changeText(field(CURRENCY(1)), "GBP");
    for (const plan of PLANS) expect(field(PRICE(plan, 1))).toHaveDisplayValue("");
    expect(field(INSTRUCTIONS(1))).toHaveDisplayValue("TRANSFERENCIA FICTICIA CO");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("importes en unidad mayor → unidad menor exacta de la moneda; con separadores de miles no se envía", async () => {
    const { api, mocks } = fakeApi(me("owner"));
    await open("admin", api);
    await fireEvent.press(await screen.findByRole("button", { name: "Añadir país" }));
    await fireEvent.changeText(field(COUNTRY(1)), "JE");
    await fireEvent.changeText(field(CURRENCY(1)), "GBP");
    await fireEvent.changeText(field(INSTRUCTIONS(1)), "TRANSFERENCIA FICTICIA JE");
    const prices = { semanal: "1,000", quincenal: "20", mensual: "35.99" };
    for (const plan of PLANS) {
      await fireEvent.changeText(field(PRICE(plan, 1)), prices[plan as keyof typeof prices]);
      await fireEvent.changeText(field(REQUESTS(plan, 1)), "10");
      await fireEvent.changeText(field(CHARS(plan, 1)), "2000");
    }
    await fireEvent.press(screen.getByRole("checkbox", { name: "Aceptar solicitudes por transferencia" }));
    await fireEvent.press(screen.getByRole("button", { name: "Guardar pagos" }));
    expect(screen.getByText(/Revisa los importes/)).toBeOnTheScreen();
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    await fireEvent.changeText(field(PRICE("semanal", 1)), "12.50");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar pagos" }));
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    const limits = { maxRequests: 10, maxChars: 2000 };
    expect(mocks.updateSettings.mock.calls[0]?.[0]).toEqual({
      payments: {
        enabled: true,
        markets: [
          {
            country: "JE",
            currency: "GBP",
            instructions: "TRANSFERENCIA FICTICIA JE",
            prices: { weekly: 1250, biweekly: 2000, monthly: 3599 },
            planLimits: { weekly: limits, biweekly: limits, monthly: limits },
          },
        ],
      },
    });
  });

  it("monedas sin decimales: JPY admite 1500 y rechaza 1500.5", async () => {
    const { api, mocks } = fakeApi(me("owner"));
    await open("admin", api);
    await fireEvent.press(await screen.findByRole("button", { name: "Añadir país" }));
    await fireEvent.changeText(field(COUNTRY(1)), "JP");
    await fireEvent.changeText(field(CURRENCY(1)), "JPY");
    await fireEvent.changeText(field(INSTRUCTIONS(1)), "TRANSFERENCIA FICTICIA JP");
    for (const plan of PLANS) {
      await fireEvent.changeText(field(PRICE(plan, 1)), plan === "semanal" ? "1500.5" : "1500");
      await fireEvent.changeText(field(REQUESTS(plan, 1)), "10");
      await fireEvent.changeText(field(CHARS(plan, 1)), "2000");
    }
    await fireEvent.press(screen.getByRole("button", { name: "Guardar pagos" }));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await fireEvent.changeText(field(PRICE("semanal", 1)), "1500");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar pagos" }));
    expect(mocks.updateSettings.mock.calls[0]?.[0]).toMatchObject({ payments: { markets: [{ currency: "JPY", prices: { weekly: 1500, biweekly: 1500, monthly: 1500 } }] } });
  });

  it("las solicitudes muestran su país y su moneda congelados (código COP)", async () => {
    const request = { ...CO_REQUEST, status: "pending", decidedAt: null, uid: "uid-bea", email: "bea@example.com" } as unknown as AdminPaymentRequestView;
    const { api } = fakeApi(me("owner"), { listPaymentRequests: ok({ requests: [request], nextCursor: null }) });
    await open("admin", api);
    const card = await screen.findByTestId(`solicitud-admin-${ID}`);
    expect(within(card).getByText("País: Colombia (CO)")).toBeOnTheScreen();
    expect(within(card).getByText(/COP/)).toBeOnTheScreen();
  });
});

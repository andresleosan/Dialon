import {
  ADMIN_CAPS,
  PAYMENT_PLAN_DAYS,
  isCountry,
  isSupportedCurrency,
  minorToMajorText,
  parseMajorToMinor,
  type AdminPaymentRequestView,
  type AdminSettings,
  type AdminStatus,
  type AdminUser,
  type PaymentMarket,
  type PaymentPlan,
  type PaymentRequestStatus,
  type PaymentSettings,
  type ProviderStatus,
  type SubscriptionLimits,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type TranslationProvider,
} from "@dialon/contracts";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "./api";
import { saveFile } from "./saveFile";
import {
  countryLabel,
  DAY_MS,
  errorText,
  formatBytes,
  formatCount,
  formatDate,
  formatMoney,
  PAYMENT_PLANS,
  PLAN_LABEL,
  PROVIDER_LABEL,
  REQUEST_LABEL,
  receiptState,
  SUBSCRIPTION_LABEL,
} from "./text";
import { Alert, Button, Card, Checkbox, Choice, Fact, Field, Heading, Paragraph, Row, Section, Status } from "./ui";
import { useRequests } from "./useRequests";

// «Administración»: solo se monta si el backend dijo que la cuenta es la del propietario, y el backend vuelve a
// comprobarlo en cada petición. Entrar no hace ninguna petición a los proveedores de traducción.

type Run = ReturnType<typeof useRequests>;

/** Entero dentro de [min, max] o `undefined`; vacío → `null`. */
function integer(text: string, min: number, max: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function limitsText(limits: SubscriptionLimits | null): string {
  return limits === null ? "sin cuota" : `${formatCount(limits.maxRequests)} peticiones y ${formatCount(limits.maxChars)} caracteres`;
}

export function AdminPanel({ api }: { readonly api: ApiClient }) {
  const request = useRequests();
  const [settings, setSettings] = useState<AdminSettings>();
  const [settingsError, setSettingsError] = useState<string>();

  useEffect(() => {
    void request((signal) => api.getSettings(signal)).then((result) => {
      if (!result) return;
      if (result.ok) setSettings(result.value);
      else setSettingsError(errorText(result.code));
    });
  }, [api, request]);

  return (
    <>
      <Heading>Administración</Heading>
      <Paragraph muted>Todo es manual: nada se aprueba ni se activa solo.</Paragraph>
      <UsersSection api={api} run={request} />
      <RequestsSection api={api} run={request} />
      <ProvidersSection api={api} run={request} settings={settings} settingsError={settingsError} onSaved={setSettings} />
      <PaymentsSection api={api} run={request} settings={settings} settingsError={settingsError} onSaved={setSettings} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------ Usuarios

function UsersSection({ api, run }: { readonly api: ApiClient; readonly run: Run }) {
  const [users, setUsers] = useState<readonly AdminUser[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();

  const load = (cursor?: string) => {
    return run((signal) => api.listUsers(cursor === undefined ? {} : { cursor }, signal)).then((result) => {
      if (!result) return;
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      setError(undefined);
      setUsers((current) => (cursor === undefined ? result.value.users : [...(current ?? []), ...result.value.users]));
      setNextCursor(result.value.nextCursor);
    });
  };

  useEffect(() => {
    void load();
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const user = users?.find((item) => item.uid === selected);

  return (
    <Section title="Usuarios">
      <Alert>{error}</Alert>
      {users === undefined ? (
        error === undefined && <Paragraph muted>Cargando usuarios…</Paragraph>
      ) : users.length === 0 ? (
        <Paragraph muted>Todavía no hay usuarios registrados.</Paragraph>
      ) : (
        users.map((item) => (
          <Card key={item.uid}>
            <Fact label="Cuenta" value={item.email ?? item.uid} />
            <Fact
              label="Suscripción"
              value={`${SUBSCRIPTION_LABEL[item.subscription.status]}${item.subscription.expiresAt !== null ? `, vence el ${formatDate(item.subscription.expiresAt)}` : ""}`}
            />
            <Row>
              <Button
                label={item.uid === selected ? "Editando" : "Editar suscripción"}
                accessibilityLabel={`Editar suscripción de ${item.email ?? item.uid}`}
                current={item.uid === selected}
                onPress={() => {
                  setSelected(item.uid);
                }}
              />
            </Row>
            {user?.uid === item.uid && (
              <SubscriptionEditor
                key={item.uid}
                api={api}
                run={run}
                user={item}
                onSaved={(saved) => {
                  setUsers((current) => current?.map((entry) => (entry.uid === saved.uid ? saved : entry)));
                }}
              />
            )}
          </Card>
        ))
      )}
      {nextCursor !== null && (
        <Row>
          <Button
            label="Cargar más usuarios"
            onPress={() => {
              void load(nextCursor);
            }}
          />
        </Row>
      )}
    </Section>
  );
}

interface EditorProps {
  readonly api: ApiClient;
  readonly run: Run;
  readonly user: AdminUser;
  readonly onSaved: (user: AdminUser) => void;
}

function SubscriptionEditor({ api, run, user, onSaved }: EditorProps) {
  const { subscription } = user;
  const [status, setStatus] = useState<SubscriptionStatus>(subscription.status === "expired" ? "inactive" : subscription.status);
  const [plan, setPlan] = useState<SubscriptionPlan>(subscription.plan ?? "monthly");
  const [days, setDays] = useState(() => {
    const left = subscription.expiresAt === null ? 0 : Math.ceil((subscription.expiresAt - Date.now()) / DAY_MS);
    return left > 0 ? String(Math.min(left, ADMIN_CAPS.maxDays)) : "";
  });
  // Sin cuota inventada: vacía si no la había.
  const [maxRequests, setMaxRequests] = useState(subscription.limits ? String(subscription.limits.maxRequests) : "");
  const [maxChars, setMaxChars] = useState(subscription.limits ? String(subscription.limits.maxChars) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  const save = async () => {
    const parsedDays = integer(days, 1, ADMIN_CAPS.maxDays);
    const requests = integer(maxRequests, 0, ADMIN_CAPS.maxRequests);
    const chars = integer(maxChars, 0, ADMIN_CAPS.maxChars);
    if (parsedDays === null || parsedDays === undefined || requests === null || requests === undefined || chars === null || chars === undefined) {
      setError(`Revisa los datos: días entre 1 y ${String(ADMIN_CAPS.maxDays)}, y la cuota con números enteros dentro de los topes.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const update = { status, plan, expiresAt: Date.now() + parsedDays * DAY_MS, limits: { maxRequests: requests, maxChars: chars } };
    const result = await run((signal) => api.updateSubscription(user.uid, update, signal));
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    onSaved({ ...user, subscription: result.value.subscription });
    setDone("Suscripción guardada.");
  };

  return (
    <Card>
      <Paragraph muted>{`Ahora: ${SUBSCRIPTION_LABEL[subscription.status]}, ${limitsText(subscription.limits)}; usado en el periodo: ${formatCount(subscription.usage.requests)} peticiones y ${formatCount(subscription.usage.chars)} caracteres.`}</Paragraph>
      <Choice
        label="Estado"
        value={status}
        options={[
          { value: "active", label: "Activa" },
          { value: "suspended", label: "Suspendida" },
          { value: "inactive", label: "Inactiva" },
        ]}
        onChange={setStatus}
      />
      <Choice
        label="Plan"
        value={plan}
        options={(["weekly", "biweekly", "monthly", "custom"] as const).map((value) => ({ value, label: PLAN_LABEL[value] }))}
        onChange={setPlan}
      />
      <Field
        label="Vence dentro de (días desde hoy)"
        value={days}
        onChangeText={setDays}
        numeric
        hint={`Entre 1 y ${String(ADMIN_CAPS.maxDays)}. Guardar empieza un periodo nuevo con el uso a cero.`}
      />
      <Field label="Peticiones por periodo" value={maxRequests} onChangeText={setMaxRequests} numeric />
      <Field label="Caracteres por periodo" value={maxChars} onChangeText={setMaxChars} numeric />
      <Alert>{error}</Alert>
      <Status>{done}</Status>
      <Row>
        <Button
          primary
          label="Guardar suscripción"
          disabled={busy}
          onPress={() => {
            void save();
          }}
        />
      </Row>
    </Card>
  );
}

// ----------------------------------------------------------------------------------------------------------- Solicitudes

type Filter = PaymentRequestStatus | "all";

function RequestsSection({ api, run }: { readonly api: ApiClient; readonly run: Run }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [items, setItems] = useState<readonly AdminPaymentRequestView[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "approve" | "reject" }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const downloads = useRef<(() => void)[]>([]);

  useEffect(() => {
    const pending = downloads.current;
    return () => {
      for (const revoke of pending) revoke();
    };
  }, []);

  const load = (status: Filter, cursor?: string) => {
    const page = { ...(status === "all" ? {} : { status }), ...(cursor === undefined ? {} : { cursor }) };
    return run((signal) => api.listPaymentRequests(page, signal)).then((result) => {
      if (!result) return;
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      setError(undefined);
      setItems((current) => (cursor === undefined ? result.value.requests : [...(current ?? []), ...result.value.requests]));
      setNextCursor(result.value.nextCursor);
    });
  };

  useEffect(() => {
    void load("pending");
    // Solo al montar; cambiar el filtro vuelve a cargar desde el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const result = await run((signal) => (action === "approve" ? api.approvePaymentRequest(id, signal) : api.rejectPaymentRequest(id, signal)));
    setBusy(false);
    setConfirming(undefined);
    if (!result) return;
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    const updated = result.value;
    setItems((current) => current?.map((item) => (item.id === updated.id ? updated : item))
      .filter((item) => filter === "all" || item.status === filter));
    setDone(action === "approve" ? "Solicitud aprobada: la suscripción se renovó una vez." : "Solicitud rechazada: no se activó nada.");
  };

  const download = async (id: string) => {
    setBusy(true);
    setError(undefined);
    const result = await run((signal) => api.downloadReceiptAsOwner(id, signal));
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    const revoke = saveFile(result.value.bytes, result.value.type, result.value.filename);
    if (revoke) downloads.current.push(revoke);
    else setError("La descarga solo está disponible en el navegador.");
  };

  return (
    <Section title="Solicitudes por transferencia">
      <Choice
        label="Mostrar"
        value={filter}
        options={[
          { value: "pending", label: "Pendientes" },
          { value: "approved", label: "Aprobadas" },
          { value: "rejected", label: "Rechazadas" },
          { value: "all", label: "Todas" },
        ]}
        onChange={(value) => {
          setFilter(value);
          setItems(undefined);
          setConfirming(undefined);
          void load(value);
        }}
      />
      <Paragraph muted>Abre el comprobante y comprueba la transferencia en tu banco antes de aprobar.</Paragraph>
      <Alert>{error}</Alert>
      <Status>{done}</Status>
      {items === undefined ? (
        error === undefined && <Paragraph muted>Cargando solicitudes…</Paragraph>
      ) : items.length === 0 ? (
        <Paragraph muted>No hay solicitudes en esta lista.</Paragraph>
      ) : (
        items.map((item) => {
          const who = item.email ?? item.uid;
          const ready = item.status === "pending" && item.receipt?.available === true;
          return (
            <Card key={item.id} testID={`solicitud-admin-${item.id}`}>
              <Fact label="Cuenta" value={who} />
              <Fact label="País" value={countryLabel(item.country)} />
              <Fact
                label="Plan"
                value={`${PLAN_LABEL[item.plan]}, ${String(item.days)} días · ${formatMoney(item.amountMinor, item.currency)} · ${limitsText(item.limits)}`}
              />
              <Fact label="Estado" value={REQUEST_LABEL[item.status]} />
              <Fact label="Creada" value={formatDate(item.createdAt)} />
              <Fact
                label="Comprobante"
                value={
                  item.receipt === null
                    ? "sin subir"
                    : `${formatBytes(item.receipt.bytes)}, subido el ${formatDate(item.receipt.uploadedAt)}, ${receiptState(item.receipt, item.status)}`
                }
              />
              <Row>
                {item.receipt?.available === true && (
                  <Button
                    label="Descargar comprobante"
                    accessibilityLabel={`Descargar comprobante de ${who}`}
                    disabled={busy}
                    onPress={() => {
                      void download(item.id);
                    }}
                  />
                )}
                {confirming?.id === item.id ? (
                  <>
                    <Button
                      primary
                      label={confirming.action === "approve" ? "Confirmar aprobación" : "Confirmar rechazo"}
                      disabled={busy}
                      onPress={() => {
                        void decide(item.id, confirming.action);
                      }}
                    />
                    <Button
                      label="Cancelar"
                      disabled={busy}
                      onPress={() => {
                        setConfirming(undefined);
                      }}
                    />
                  </>
                ) : (
                  item.status === "pending" && (
                    <>
                      <Button
                        label="Aprobar"
                        accessibilityLabel={`Aprobar solicitud de ${who}`}
                        disabled={busy || !ready}
                        onPress={() => {
                          setConfirming({ id: item.id, action: "approve" });
                        }}
                      />
                      <Button
                        label="Rechazar"
                        accessibilityLabel={`Rechazar solicitud de ${who}`}
                        disabled={busy}
                        onPress={() => {
                          setConfirming({ id: item.id, action: "reject" });
                        }}
                      />
                    </>
                  )
                )}
              </Row>
              {item.status === "pending" && !ready && <Paragraph muted>Para aprobar hace falta un comprobante disponible.</Paragraph>}
            </Card>
          );
        })
      )}
      {nextCursor !== null && (
        <Row>
          <Button
            label="Cargar más solicitudes"
            onPress={() => {
              void load(filter, nextCursor);
            }}
          />
        </Row>
      )}
    </Section>
  );
}

// --------------------------------------------------------------------------------------------------------- Proveedores

interface SettingsSectionProps {
  readonly api: ApiClient;
  readonly run: Run;
  readonly settings: AdminSettings | undefined;
  readonly settingsError: string | undefined;
  readonly onSaved: (settings: AdminSettings) => void;
}

const PROVIDER_NAME: Readonly<Record<TranslationProvider, string>> = {
  sarin: "Sarin (servidor del propietario)",
  deepseek: "DeepSeek (proveedor externo)",
};

function ProviderFacts({ provider, status }: { readonly provider: TranslationProvider; readonly status: ProviderStatus }) {
  return (
    <Card>
      <Paragraph>{PROVIDER_NAME[provider]}</Paragraph>
      <Fact label="Configuración en el servidor" value={status.configured ? "Completa" : "Falta"} />
      <Fact label="Registro" value={PROVIDER_LABEL[status.state]} />
      <Fact label="Última respuesta válida" value={formatDate(status.lastSuccessAt)} />
      <Fact label="Último fallo registrado" value={formatDate(status.lastFailureAt)} />
    </Card>
  );
}

function ProvidersSection({ api, run, settings, settingsError, onSaved }: SettingsSectionProps) {
  const [status, setStatus] = useState<AdminStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [draft, setDraft] = useState<AdminSettings["translation"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  useEffect(() => {
    void run((signal) => api.getStatus(signal)).then((result) => {
      if (!result) return;
      if (result.ok) setStatus(result.value);
      else setStatusError(errorText(result.code));
    });
  }, [api, run]);

  const translation = draft ?? settings?.translation;

  const save = async () => {
    if (!translation) return;
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const result = await run((signal) => api.updateSettings({ translation }, signal));
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    setDraft(undefined);
    onSaved(result.value);
    setDone("Proveedor guardado.");
  };

  return (
    <Section title="Proveedor de traducción">
      <Paragraph muted>
        El registro es histórico (peticiones reales de usuarios), no una comprobación en vivo: mirar esta sección no llama a ningún proveedor.
        Las claves se configuran solo en el servidor.
      </Paragraph>
      <Alert>{statusError}</Alert>
      {status && (
        <>
          <ProviderFacts provider="sarin" status={status.providers.sarin} />
          <ProviderFacts provider="deepseek" status={status.providers.deepseek} />
        </>
      )}
      <Alert>{settingsError}</Alert>
      {translation && (
        <>
          <Checkbox
            label="Permitir proveedores externos (DeepSeek). Cada persona debe dar su consentimiento en cada petición."
            checked={translation.externalProvidersEnabled}
            onChange={(checked) => {
              // Sin externos, DeepSeek no puede quedar activo.
              setDraft({ externalProvidersEnabled: checked, activeProvider: checked ? translation.activeProvider : "sarin" });
            }}
          />
          <Choice
            label="Proveedor activo"
            value={translation.activeProvider}
            options={[
              { value: "sarin", label: PROVIDER_NAME.sarin },
              { value: "deepseek", label: PROVIDER_NAME.deepseek, disabled: !translation.externalProvidersEnabled },
            ]}
            onChange={(activeProvider) => {
              setDraft({ ...translation, activeProvider });
            }}
          />
          <Paragraph muted>Sin respaldo automático: si el proveedor activo falla, la traducción falla.</Paragraph>
          <Alert>{error}</Alert>
          <Status>{done}</Status>
          <Row>
            <Button
              primary
              label="Guardar proveedor"
              disabled={busy || draft === undefined}
              onPress={() => {
                void save();
              }}
            />
          </Row>
        </>
      )}
    </Section>
  );
}

// --------------------------------------------------------------------------------------------------------------- Pagos

type PlanTexts = Readonly<Record<PaymentPlan, string>>;
const EMPTY_PLAN_TEXTS: PlanTexts = { weekly: "", biweekly: "", monthly: "" };

/** Un país del catálogo tal como se edita: importes en UNIDAD MAYOR, como texto exacto. */
interface MarketDraft {
  readonly country: string;
  readonly currency: string;
  readonly instructions: string;
  readonly prices: PlanTexts;
  readonly maxRequests: PlanTexts;
  readonly maxChars: PlanTexts;
}

interface PaymentsDraft {
  readonly enabled: boolean;
  readonly markets: readonly MarketDraft[];
}

/** Añadir un país empieza completamente en blanco: no se clona ninguna tarifa ni datos de transferencia. */
const BLANK_MARKET: MarketDraft = {
  country: "",
  currency: "",
  instructions: "",
  prices: EMPTY_PLAN_TEXTS,
  maxRequests: EMPTY_PLAN_TEXTS,
  maxChars: EMPTY_PLAN_TEXTS,
};

/** Moneda habitual que se SUGIERE (nunca se rellena sola ni trae precios). */
const SUGGESTED_CURRENCY: Readonly<Record<string, string>> = { CO: "COP", JE: "GBP" };

function draftOf(payments: PaymentSettings): PaymentsDraft {
  const texts = (pick: (plan: PaymentPlan) => string): PlanTexts => ({ weekly: pick("weekly"), biweekly: pick("biweekly"), monthly: pick("monthly") });
  return {
    enabled: payments.enabled,
    markets: payments.markets.map((market) => ({
      country: market.country,
      currency: market.currency,
      instructions: market.instructions,
      prices: texts((plan) => {
        const price = market.prices[plan];
        return price === null ? "" : (minorToMajorText(price, market.currency) ?? "");
      }),
      maxRequests: texts((plan) => String(market.planLimits[plan]?.maxRequests ?? "")),
      maxChars: texts((plan) => String(market.planLimits[plan]?.maxChars ?? "")),
    })),
  };
}

type Converted = { readonly ok: true; readonly value: PaymentSettings } | { readonly ok: false; readonly error: string };

const AMOUNTS_ERROR = "Revisa los importes: usa la unidad mayor, sin separadores de miles y con los decimales de la moneda como máximo.";
const DATA_ERROR = "Revisa los países: código de 2 letras sin repetir, moneda ISO admitida y cuotas enteras mayores que cero dentro de los topes.";
const INCOMPLETE_ERROR = "Para aceptar solicitudes hace falta al menos un país con moneda, instrucciones y precio y cuota de los tres planes.";

/** Del formulario al contrato: importes exactos a unidad menor según la moneda; vacío = sin configurar (`null`). */
function paymentsOf(draft: PaymentsDraft): Converted {
  const markets: PaymentMarket[] = [];
  let amountsInvalid = false;
  let dataInvalid = false;
  for (const market of draft.markets) {
    const currency = market.currency.trim();
    const prices: Record<PaymentPlan, number | null> = { weekly: null, biweekly: null, monthly: null };
    const planLimits: Record<PaymentPlan, SubscriptionLimits | null> = { weekly: null, biweekly: null, monthly: null };
    if (!isCountry(market.country) || (currency !== "" && !isSupportedCurrency(currency))) dataInvalid = true;
    for (const plan of PAYMENT_PLANS) {
      const text = market.prices[plan].trim();
      if (text !== "") {
        const amount = parseMajorToMinor(text, currency);
        if (amount === undefined) amountsInvalid = true;
        else prices[plan] = amount;
      }
      const requests = integer(market.maxRequests[plan], 1, ADMIN_CAPS.maxRequests);
      const chars = integer(market.maxChars[plan], 1, ADMIN_CAPS.maxChars);
      if (requests === undefined || chars === undefined || (requests === null) !== (chars === null)) dataInvalid = true;
      else planLimits[plan] = requests === null || chars === null ? null : { maxRequests: requests, maxChars: chars };
    }
    markets.push({ country: market.country, currency, instructions: market.instructions, prices, planLimits });
  }
  if (amountsInvalid) return { ok: false, error: AMOUNTS_ERROR };
  if (dataInvalid || new Set(markets.map((market) => market.country)).size !== markets.length) return { ok: false, error: DATA_ERROR };
  const complete = (market: PaymentMarket) =>
    market.currency !== "" &&
    market.instructions.trim() !== "" &&
    PAYMENT_PLANS.every((plan) => market.prices[plan] !== null && market.planLimits[plan] !== null);
  if (draft.enabled && (markets.length === 0 || !markets.every(complete))) return { ok: false, error: INCOMPLETE_ERROR };
  return { ok: true, value: { enabled: draft.enabled, markets } };
}

function PaymentsSection({ api, run, settings, onSaved }: SettingsSectionProps) {
  const [draft, setDraft] = useState<PaymentsDraft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const form = draft ?? (settings ? draftOf(settings.payments) : undefined);
  if (!form) return null;

  const setMarket = (index: number, change: (market: MarketDraft) => MarketDraft) => {
    setDraft({ ...form, markets: form.markets.map((market, at) => (at === index ? change(market) : market)) });
  };

  const save = async () => {
    const converted = paymentsOf(form);
    if (!converted.ok) {
      setError(converted.error);
      return;
    }
    const payments = converted.value;
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const result = await run((signal) => api.updateSettings({ payments }, signal));
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    setDraft(undefined);
    onSaved(result.value);
    setDone("Ajustes de pago guardados.");
  };

  return (
    <Section title="Pagos por transferencia">
      <Checkbox
        label="Aceptar solicitudes por transferencia"
        checked={form.enabled}
        onChange={(enabled) => {
          setDraft({ ...form, enabled });
        }}
      />
      <Paragraph muted>
        Tarifas por país, cada una en su moneda. Importes en unidad mayor con punto decimal y sin separadores de miles (p. ej.
        12.50). Sin conversión entre monedas: cada país tiene sus propios importes.
      </Paragraph>
      {form.markets.map((market, index) => {
        const n = String(index + 1);
        const suggested = SUGGESTED_CURRENCY[market.country];
        return (
          <Card key={index}>
            <Paragraph>{market.country === "" ? `Mercado ${n}` : `Mercado ${n}: ${countryLabel(market.country)}`}</Paragraph>
            <Field
              label={`País del mercado ${n} (código de 2 letras)`}
              value={market.country}
              maxLength={2}
              onChangeText={(value) => {
                setMarket(index, (current) => ({ ...current, country: value.toUpperCase() }));
              }}
            />
            <Field
              label={`Moneda del mercado ${n} (código ISO, p. ej. COP)`}
              value={market.currency}
              maxLength={3}
              hint={suggested !== undefined && market.currency === "" ? `Moneda habitual en ${market.country}: ${suggested}.` : "Cambiar la moneda vacía los precios de este país."}
              onChangeText={(value) => {
                const currency = value.toUpperCase();
                // Otra moneda: los importes se vuelven a escribir; nunca el mismo número con otro símbolo o exponente.
                setMarket(index, (current) => (currency === current.currency ? current : { ...current, currency, prices: EMPTY_PLAN_TEXTS }));
              }}
            />
            <Field
              label={`Instrucciones del mercado ${n}`}
              value={market.instructions}
              multiline
              maxLength={ADMIN_CAPS.maxInstructionsChars}
              hint={`Las verá quien elija este país. ${String(ADMIN_CAPS.maxInstructionsChars)} caracteres como máximo.`}
              onChangeText={(instructions) => {
                setMarket(index, (current) => ({ ...current, instructions }));
              }}
            />
            {PAYMENT_PLANS.map((plan) => {
              const name = PLAN_LABEL[plan].toLowerCase();
              const amount = parseMajorToMinor(market.prices[plan].trim(), market.currency);
              return (
                <View key={plan}>
                  <Paragraph>{`${PLAN_LABEL[plan]} (${String(PAYMENT_PLAN_DAYS[plan])} días)`}</Paragraph>
                  <Field
                    label={`Precio ${name} del mercado ${n} (unidad mayor)`}
                    value={market.prices[plan]}
                    decimal
                    hint={amount === undefined ? undefined : formatMoney(amount, market.currency)}
                    onChangeText={(value) => {
                      setMarket(index, (current) => ({ ...current, prices: { ...current.prices, [plan]: value } }));
                    }}
                  />
                  <Field
                    label={`Peticiones por periodo, plan ${name}, mercado ${n}`}
                    value={market.maxRequests[plan]}
                    numeric
                    onChangeText={(value) => {
                      setMarket(index, (current) => ({ ...current, maxRequests: { ...current.maxRequests, [plan]: value } }));
                    }}
                  />
                  <Field
                    label={`Caracteres por periodo, plan ${name}, mercado ${n}`}
                    value={market.maxChars[plan]}
                    numeric
                    onChangeText={(value) => {
                      setMarket(index, (current) => ({ ...current, maxChars: { ...current.maxChars, [plan]: value } }));
                    }}
                  />
                </View>
              );
            })}
            <Row>
              <Button
                label={`Quitar mercado ${n}`}
                onPress={() => {
                  setDraft({ ...form, markets: form.markets.filter((_, at) => at !== index) });
                }}
              />
            </Row>
          </Card>
        );
      })}
      <Row>
        <Button
          label="Añadir país"
          disabled={form.markets.length >= ADMIN_CAPS.maxMarkets}
          onPress={() => {
            setDraft({ ...form, markets: [...form.markets, BLANK_MARKET] });
          }}
        />
      </Row>
      <Alert>{error}</Alert>
      <Status>{done}</Status>
      <Row>
        <Button
          primary
          label="Guardar pagos"
          disabled={busy || draft === undefined}
          onPress={() => {
            void save();
          }}
        />
      </Row>
    </Section>
  );
}

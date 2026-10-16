import { countryFromLocales, type MeResponse, type PaymentPlan, type PaymentRequestView } from "@dialon/contracts";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "./api";
import { ReceiptPicker, type PickedReceipt } from "./ReceiptPicker";
import { saveFile } from "./saveFile";
import {
  countryLabel,
  errorText,
  formatBytes,
  formatCount,
  formatDate,
  formatMoney,
  PLAN_LABEL,
  RECEIPT_RULES,
  REQUEST_LABEL,
  receiptState,
  SUBSCRIPTION_LABEL,
} from "./text";
import { Alert, Button, Card, Choice, Fact, Heading, Paragraph, Row, Section, Status } from "./ui";
import { useRequests } from "./useRequests";

export interface SubscriptionPanelProps {
  readonly api: ApiClient;
  readonly me: MeResponse;
  /** UUID v4 para la clave de idempotencia de cada solicitud nueva. */
  readonly createId: () => string;
  /** Vuelve a pedir la cuenta (p. ej. tras una aprobación). */
  readonly onReload: () => void;
}

/** «Otro país»: un país sin tarifa propia. Nunca se sustituye por la de otro país. */
const OTHER = "otro";
/** Siempre en la lista, aunque aún no tengan tarifa. */
const BASE_COUNTRIES = ["CO", "JE"];

/**
 * Sugerencia PASIVA: solo una región explícita en los idiomas del navegador («es-CO» → CO). Nada de GPS, IP ni red,
 * y nunca se preselecciona.
 */
function suggestedCountry(): string | undefined {
  const languages = (globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages;
  return Array.isArray(languages) ? countryFromLocales(languages) : undefined;
}

/**
 * «Mi suscripción»: estado y cuota del periodo según el backend; el usuario elige su país y ve SOLO la tarifa de ese
 * país (planes de 7/14/30 días, moneda e instrucciones del propietario); solicitud por transferencia y comprobante
 * privado. Nada se activa aquí: solo la aprobación manual.
 */
export function SubscriptionPanel({ api, me, createId, onReload }: SubscriptionPanelProps) {
  const request = useRequests();
  const [requests, setRequests] = useState<readonly PaymentRequestView[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [suggestion] = useState(suggestedCountry);
  const [country, setCountry] = useState<string>();
  const [plan, setPlan] = useState<PaymentPlan>();
  // La misma clave para los reintentos de la misma solicitud (mismo país y plan): repetirla nunca crea otra.
  const attempt = useRef<{ country: string; plan: PaymentPlan; key: string }>(undefined);
  const [picked, setPicked] = useState<PickedReceipt>();
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

  const load = (cursor?: string) => {
    return request((signal) => api.listMyPaymentRequests(cursor === undefined ? {} : { cursor }, signal)).then((result) => {
      if (!result) return;
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      setError(undefined);
      setRequests((current) => (cursor === undefined ? result.value.requests : [...(current ?? []), ...result.value.requests]));
      setNextCursor(result.value.nextCursor);
    });
  };

  useEffect(() => {
    void load();
    // Solo al montar: el panel se monta de nuevo por cuenta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replace = (updated: PaymentRequestView) => {
    setRequests((current) => [updated, ...(current ?? []).filter((item) => item.id !== updated.id)]);
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      if (plan === undefined || market === undefined) return;
      const chosen = market.country;
      if (attempt.current?.plan !== plan || attempt.current.country !== chosen) attempt.current = { country: chosen, plan, key: createId() };
      const { key } = attempt.current;
      const result = await request((signal) => api.createPaymentRequest({ country: chosen, plan, idempotencyKey: key }, signal));
      if (!result) return;
      if (!result.ok) {
        // Sin conexión o plazo: se reintenta con la misma clave. Otro error: la próxima vez, clave nueva.
        if (result.code !== "NETWORK" && result.code !== "TIMEOUT") attempt.current = undefined;
        setError(errorText(result.code));
        return;
      }
      attempt.current = undefined;
      replace(result.value);
      setDone("Solicitud creada. Haz la transferencia con las instrucciones y sube el comprobante.");
    });

  const upload = (id: string) =>
    run(async () => {
      if (!picked) return;
      const result = await request((signal) => api.uploadReceipt(id, { data: picked.data, type: picked.type }, signal));
      if (!result) return;
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      setPicked(undefined);
      replace(result.value);
      setDone("Comprobante recibido. El propietario lo revisará; hasta su aprobación no se activa nada.");
    });

  const download = (id: string) =>
    run(async () => {
      const result = await request((signal) => api.downloadMyReceipt(id, signal));
      if (!result) return;
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      const revoke = saveFile(result.value.bytes, result.value.type, result.value.filename);
      if (revoke) downloads.current.push(revoke);
      else setError("La descarga solo está disponible en el navegador.");
    });

  const { subscription, payments } = me;
  const pending = requests?.find((item) => item.status === "pending");
  const markets = payments.enabled ? payments.markets : [];
  const market = markets.find((candidate) => candidate.country === country);
  const countries = [...new Set([...BASE_COUNTRIES, ...markets.map((candidate) => candidate.country), ...(suggestion ? [suggestion] : [])])];
  const limits = subscription.limits;

  // Cambiar de país invalida el plan y el intento en curso; las solicitudes guardadas no cambian.
  const chooseCountry = (next: string) => {
    if (next === country) return;
    setCountry(next);
    setPlan(undefined);
    attempt.current = undefined;
  };

  return (
    <>
      <Heading>Mi suscripción</Heading>
      <Alert>{error}</Alert>
      <Status>{done}</Status>

      <Section title="Estado">
        <Fact label="Estado" value={SUBSCRIPTION_LABEL[subscription.status]} />
        {subscription.plan !== null && <Fact label="Plan" value={PLAN_LABEL[subscription.plan]} />}
        {subscription.expiresAt !== null && <Fact label="Vence" value={formatDate(subscription.expiresAt)} />}
        {limits !== null && (
          <Fact
            label="Uso en este periodo"
            value={`${formatCount(subscription.usage.requests)} de ${formatCount(limits.maxRequests)} peticiones · ${formatCount(subscription.usage.chars)} de ${formatCount(limits.maxChars)} caracteres`}
          />
        )}
        {subscription.status !== "active" && (
          <Paragraph muted>Sin suscripción activa. La traducción de texto necesita una suscripción aprobada por el propietario.</Paragraph>
        )}
        <Paragraph muted>
          La suscripción cubre la traducción de texto. La conversación por voz de esta versión sigue siendo una demostración.
        </Paragraph>
        <Row>
          <Button
            label="Actualizar"
            disabled={busy}
            onPress={() => {
              setDone(undefined);
              setError(undefined);
              onReload();
              void load();
            }}
          />
        </Row>
      </Section>

      <Section title="Solicitar por transferencia">
        {markets.length === 0 ? (
          <Paragraph>Las solicitudes de suscripción no están disponibles por ahora.</Paragraph>
        ) : pending ? (
          <Paragraph>Ya tienes una solicitud pendiente. Cuando el propietario la revise podrás pedir otra.</Paragraph>
        ) : (
          <>
            <Paragraph>
              {suggestion
                ? `Tu dispositivo sugiere ${countryLabel(suggestion)}. Elige tu país para ver las tarifas.`
                : "Elige tu país para ver las tarifas."}
            </Paragraph>
            <Choice
              label="País"
              value={country}
              options={[...countries.map((code) => ({ value: code, label: countryLabel(code) })), { value: OTHER, label: "Otro país" }]}
              onChange={chooseCountry}
            />
            {country === undefined ? null : market === undefined ? (
              <Paragraph>Todavía no hay tarifa para este país.</Paragraph>
            ) : (
              <>
                <Choice
                  label="Plan"
                  value={plan}
                  options={market.plans.map((offer) => ({
                    value: offer.plan,
                    label: `${PLAN_LABEL[offer.plan]}: ${String(offer.days)} días · ${formatMoney(offer.amountMinor, market.currency)} · ${formatCount(offer.limits.maxRequests)} peticiones y ${formatCount(offer.limits.maxChars)} caracteres`,
                  }))}
                  onChange={setPlan}
                />
                <Card>
                  <Paragraph>Instrucciones para la transferencia:</Paragraph>
                  <Paragraph>{market.instructions}</Paragraph>
                </Card>
                <Paragraph muted>
                  Solicitar no cobra nada ni activa nada. Haz la transferencia, sube el comprobante y el propietario lo revisará a mano.
                </Paragraph>
                <Row>
                  <Button
                    primary
                    label="Solicitar suscripción"
                    disabled={busy || plan === undefined}
                    onPress={() => {
                      void create();
                    }}
                  />
                </Row>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Mis solicitudes">
        <Paragraph muted>{RECEIPT_RULES}</Paragraph>
        {requests === undefined ? (
          error === undefined && <Paragraph muted>Cargando solicitudes…</Paragraph>
        ) : requests.length === 0 ? (
          <Paragraph muted>Todavía no has hecho ninguna solicitud.</Paragraph>
        ) : (
          requests.map((item) => (
            <Card key={item.id} testID={`solicitud-${item.id}`}>
              {/* Copia congelada al crearla: elegir otro país arriba no la cambia. */}
              <Fact label="País" value={countryLabel(item.country)} />
              <Fact label="Solicitud" value={`${PLAN_LABEL[item.plan]}, ${String(item.days)} días · ${formatMoney(item.amountMinor, item.currency)}`} />
              <Fact label="Estado" value={REQUEST_LABEL[item.status]} />
              <Fact label="Creada" value={formatDate(item.createdAt)} />
              {item.decidedAt !== null && <Fact label="Revisada" value={formatDate(item.decidedAt)} />}
              {item.receipt !== null ? (
                <>
                  <Fact
                    label="Comprobante"
                    value={`${formatBytes(item.receipt.bytes)}, subido el ${formatDate(item.receipt.uploadedAt)}, ${receiptState(item.receipt, item.status)}`}
                  />
                  {item.receipt.available && (
                    <Row>
                      <Button
                        label="Descargar mi comprobante"
                        disabled={busy}
                        onPress={() => {
                          void download(item.id);
                        }}
                      />
                    </Row>
                  )}
                </>
              ) : item.status === "pending" ? (
                <>
                  <ReceiptPicker
                    disabled={busy}
                    onPick={(file) => {
                      setError(undefined);
                      setPicked(file);
                    }}
                    onReject={(reason) => {
                      setPicked(undefined);
                      setError(reason);
                    }}
                  />
                  {picked && <Paragraph>{`Archivo elegido: ${picked.name} (${formatBytes(picked.bytes)})`}</Paragraph>}
                  <Row>
                    <Button
                      primary
                      label="Subir comprobante"
                      disabled={busy || !picked}
                      onPress={() => {
                        void upload(item.id);
                      }}
                    />
                  </Row>
                </>
              ) : null}
            </Card>
          ))
        )}
        {nextCursor !== null && (
          <Row>
            <Button
              label="Ver más solicitudes"
              disabled={busy}
              onPress={() => {
                void load(nextCursor);
              }}
            />
          </Row>
        )}
      </Section>
    </>
  );
}

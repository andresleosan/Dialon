import type { MeResponse } from "@dialon/contracts";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "../theme";
import { AdminPanel } from "./AdminPanel";
import type { ApiClient } from "./api";
import type { PanelName } from "./panelRoute";
import { SubscriptionPanel } from "./SubscriptionPanel";
import { errorText } from "./text";
import { Alert, Button, Heading, Paragraph, Row } from "./ui";
import { useRequests } from "./useRequests";

export interface AccountScreenProps {
  /** Sin API configurada no hay cuenta que mostrar ni ninguna petición. */
  readonly api: ApiClient | undefined;
  readonly panel: PanelName;
  /** `undefined` vuelve a la conversación. */
  readonly onNavigate: (panel: PanelName | undefined) => void;
  readonly createId: () => string;
  readonly signOut: { readonly label: string; readonly accessibilityLabel: string; readonly onPress: () => void };
  /** Aviso de sesión (p. ej. no se pudo cerrar). */
  readonly notice?: string;
}

type Load = { readonly state: "loading" } | { readonly state: "failed"; readonly message: string } | { readonly state: "ready"; readonly me: MeResponse };

/**
 * Cuenta de la sesión actual. El rol lo da SOLO `GET /v1/me`: «Administración» aparece y se dibuja únicamente si el
 * backend responde `owner`. Se monta con `key = uid`: cambiar de cuenta o cerrar sesión desmonta todo y cancela sus
 * peticiones.
 */
export function AccountScreen({ api, panel, onNavigate, createId, signOut, notice }: AccountScreenProps) {
  const insets = useSafeAreaInsets();
  const request = useRequests();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchMe = useCallback(() => {
    if (!api) return Promise.resolve();
    return request((signal) => api.getMe(signal)).then((result) => {
      if (!result) return;
      setLoad(result.ok ? { state: "ready", me: result.value } : { state: "failed", message: errorText(result.code) });
    });
  }, [api, request]);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const owner = load.state === "ready" && load.me.role === "owner";

  return (
    <ScrollView
      testID="cuenta"
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: 16 + insets.top, paddingBottom: 24 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.brand}>Dialon</Text>
        <Row>
          <Button
            label="Conversación"
            onPress={() => {
              onNavigate(undefined);
            }}
          />
          <Button
            label="Mi suscripción"
            current={panel === "subscription"}
            onPress={() => {
              onNavigate("subscription");
            }}
          />
          {owner && (
            <Button
              label="Administración"
              current={panel === "admin"}
              onPress={() => {
                onNavigate("admin");
              }}
            />
          )}
          <Button label={signOut.label} accessibilityLabel={signOut.accessibilityLabel} onPress={signOut.onPress} />
        </Row>
      </View>
      <Alert>{notice}</Alert>

      {!api ? (
        <>
          <Heading>Cuenta</Heading>
          <Paragraph>El servicio de cuentas no está configurado en esta versión. La conversación sigue disponible como demostración.</Paragraph>
        </>
      ) : load.state === "loading" ? (
        <Paragraph muted>Cargando tu cuenta…</Paragraph>
      ) : load.state === "failed" ? (
        <>
          <Alert>{load.message}</Alert>
          <Row>
            <Button
              label="Reintentar"
              onPress={() => {
                setLoad({ state: "loading" });
                void fetchMe();
              }}
            />
          </Row>
        </>
      ) : panel === "admin" ? (
        owner ? (
          <AdminPanel api={api} />
        ) : (
          <Alert>No tienes acceso a la administración.</Alert>
        )
      ) : (
        <SubscriptionPanel
          api={api}
          me={load.me}
          createId={createId}
          onReload={() => {
            void fetchMe();
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.fondo },
  content: { width: "100%", maxWidth: 880, alignSelf: "center", gap: 16 },
  header: { gap: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.linea },
  brand: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.8, color: COLORS.tinta },
});

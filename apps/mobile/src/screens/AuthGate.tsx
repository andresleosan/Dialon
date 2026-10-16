import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button as AccountButton } from "../account/ui";
import { AccountScreen } from "../account/AccountScreen";
import type { ApiClient } from "../account/api";
import { panelRoute as defaultPanelRoute, type PanelName, type PanelRoute } from "../account/panelRoute";
import type { LocalAudio } from "../audio/capture";
import type { AuthSessionProvider } from "../auth/session";
import { useAuthSession } from "../auth/useAuthSession";
import { AUTH } from "../copy";
import { FaceToFaceScreen } from "./FaceToFaceScreen";
import { SignInScreen } from "./SignInScreen";

export interface AuthGateProps {
  /** Sesión de la plataforma; `undefined` en nativo, que va directo a la DEMO. */
  readonly provider: AuthSessionProvider | undefined;
  readonly createRequestId: () => string;
  readonly audio?: LocalAudio;
  /** Cliente del API; sin él (sin URL configurada, por defecto) no hay ninguna petición al servidor. */
  readonly api?: ApiClient;
  /** Panel de cuenta en la URL (`?panel=`); en nativo no hay. Inyectable para pruebas. */
  readonly panelRoute?: PanelRoute;
}

type ConversationProps = Omit<AuthGateProps, "provider" | "api" | "panelRoute">;

/**
 * Entrada de la app. Nativo: la DEMO tal cual. Web: pantalla inicial con Google o demo local sin cuenta. La
 * conversación se monta con `key = uid` (otra cuenta, conversación nueva) y está desmontada mientras se abre Google
 * o se cierra sesión: su limpieza al desmontar suelta micrófono, medidor, reproducción y clip.
 */
export function AuthGate({ provider, api, panelRoute = defaultPanelRoute, ...conversation }: AuthGateProps) {
  if (!provider) return <FaceToFaceScreen {...conversation} />;
  return <SessionGate provider={provider} api={api} panelRoute={panelRoute} {...conversation} />;
}

interface SessionGateProps extends ConversationProps {
  readonly provider: AuthSessionProvider;
  readonly api: ApiClient | undefined;
  readonly panelRoute: PanelRoute;
}

function SessionGate({ provider, api, panelRoute, createRequestId, audio }: SessionGateProps) {
  const session = useAuthSession(provider);
  const [guest, setGuest] = useState(false);
  const [panel, setPanel] = useState<PanelName | undefined>(() => panelRoute.read());
  const { user, busy, error, failure } = session;

  useEffect(() => panelRoute.subscribe(setPanel), [panelRoute]);

  if (busy === undefined && user && panel !== undefined) {
    const name = user.name ?? AUTH.accountFallback;
    // Paneles de cuenta solo con sesión; quién es propietario lo decide el backend dentro de la pantalla.
    return (
      <AccountScreen
        key={user.uid}
        api={api}
        panel={panel}
        createId={createRequestId}
        notice={error && AUTH.errors[error]}
        onNavigate={(next) => {
          panelRoute.write(next);
          setPanel(next);
        }}
        signOut={{
          label: AUTH.signOut,
          accessibilityLabel: `${AUTH.signOut}, ${name}`,
          onPress: () => {
            setGuest(false);
            session.signOut();
          },
        }}
      />
    );
  }

  if (busy === undefined && user) {
    const name = user.name ?? AUTH.accountFallback;
    const conversation = (
      <FaceToFaceScreen
        key={user.uid}
        createRequestId={createRequestId}
        audio={audio}
        session={{
          label: AUTH.signOut,
          accessibilityLabel: `${AUTH.signOut}, ${name}`,
          accountName: name,
          notice: error && AUTH.errors[error],
          onPress: () => {
            setGuest(false);
            session.signOut();
          },
        }}
      />
    );
    if (!api) return conversation;
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, alignItems: "flex-end" }}>
          <AccountButton
            label="Mi suscripción"
            onPress={() => {
              panelRoute.write("subscription");
              setPanel("subscription");
            }}
          />
        </View>
        {conversation}
      </View>
    );
  }

  if (busy === undefined && guest && error === undefined && !user) {
    return (
      <FaceToFaceScreen
        key="invitado"
        createRequestId={createRequestId}
        audio={audio}
        session={{ label: AUTH.signIn, accessibilityLabel: AUTH.signInFull, onPress: session.signIn }}
      />
    );
  }

  const checking = user === undefined && failure === undefined;
  const status =
    busy === "signIn" ? AUTH.signingIn : busy === "signOut" ? AUTH.signingOut : checking ? AUTH.checking : undefined;
  const alert = error !== undefined ? AUTH.errors[error] : failure !== undefined && !user ? AUTH.failure : undefined;
  return (
    <SignInScreen
      status={status}
      alert={alert}
      googleDisabled={busy !== undefined || checking || failure !== undefined}
      demoDisabled={busy !== undefined}
      onGoogle={session.signIn}
      onDemo={() => {
        session.clearError();
        setGuest(true);
      }}
      onRetry={failure !== undefined && !user ? session.retry : undefined}
    />
  );
}

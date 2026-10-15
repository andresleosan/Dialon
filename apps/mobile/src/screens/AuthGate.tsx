import { useState } from "react";
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
}

type ConversationProps = Omit<AuthGateProps, "provider">;

/**
 * Entrada de la app. Nativo: la DEMO tal cual. Web: pantalla inicial con Google o demo local sin cuenta. La
 * conversación se monta con `key = uid` (otra cuenta, conversación nueva) y está desmontada mientras se abre Google
 * o se cierra sesión: su limpieza al desmontar suelta micrófono, medidor, reproducción y clip.
 */
export function AuthGate({ provider, ...conversation }: AuthGateProps) {
  if (!provider) return <FaceToFaceScreen {...conversation} />;
  return <SessionGate provider={provider} {...conversation} />;
}

function SessionGate({ provider, createRequestId, audio }: ConversationProps & { readonly provider: AuthSessionProvider }) {
  const session = useAuthSession(provider);
  const [guest, setGuest] = useState(false);
  const { user, busy, error, failure } = session;

  if (busy === undefined && user) {
    const name = user.name ?? AUTH.accountFallback;
    return (
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

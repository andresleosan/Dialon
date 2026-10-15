// Sesión de una cuenta en el dispositivo compartido. Tipos portables: sin Firebase, DOM ni Expo. A y B siguen siendo
// papeles de la conversación, no cuentas.

/** Lo único que la interfaz necesita de la cuenta: nunca correo, tokens ni credenciales. */
export interface AuthUser {
  readonly uid: string;
  /** Nombre visible de la cuenta, si lo tiene. */
  readonly name?: string;
}

export type AuthErrorCode =
  | "POPUP_BLOCKED"
  | "NETWORK"
  | "CONFIG"
  | "RATE_LIMITED"
  | "ACCOUNT_DISABLED"
  | "BROWSER"
  | "UNKNOWN"
  | "SIGN_OUT_FAILED";

/** Resultado de abrir Google. Cancelar el popup no es un error. */
export type SignInOutcome =
  | { readonly status: "ok" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly code: AuthErrorCode };

/** Proveedor de sesión inyectable: web hoy; un adaptador nativo implementará lo mismo. */
export interface AuthSessionProvider {
  /**
   * Avisa de la cuenta actual (o `null`) y de cada cambio, y con `onError` si no se puede leer la sesión. Devuelve cómo
   * dejar de escuchar.
   */
  subscribe(onUser: (user: AuthUser | null) => void, onError: (code: AuthErrorCode) => void): () => void;
  /** Debe abrir Google en el mismo gesto del usuario: sin esperas antes del popup. */
  signInWithGoogle(): Promise<SignInOutcome>;
  signOut(): Promise<void>;
}

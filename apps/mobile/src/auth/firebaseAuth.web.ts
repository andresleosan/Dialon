import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type Auth, type User } from "firebase/auth";
import { FIREBASE_CONFIG } from "./firebaseConfig";
import type { AuthErrorCode, AuthSessionProvider, AuthUser, IdTokenSource, SignInOutcome } from "./session";

// Solo Authentication: nada de Analytics, Firestore ni Storage. La sesión la guarda el SDK con su persistencia web
// por defecto. Solo getIdToken devuelve el ID token vigente para el API; no se guarda ni registra, ni se exponen correos.

let auth: Auth | undefined;

/** Inicialización perezosa: importar el módulo no toca el SDK. Puede lanzar si la configuración no vale. */
function currentAuth(): Auth {
  auth ??= getAuth(getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG));
  return auth;
}

const CANCELLED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);
const CODES: Readonly<Record<string, AuthErrorCode>> = {
  "auth/popup-blocked": "POPUP_BLOCKED",
  "auth/network-request-failed": "NETWORK",
  "auth/unauthorized-domain": "CONFIG",
  "auth/operation-not-allowed": "CONFIG",
  "auth/invalid-api-key": "CONFIG",
  "auth/configuration-not-found": "CONFIG",
  "auth/too-many-requests": "RATE_LIMITED",
  "auth/user-disabled": "ACCOUNT_DISABLED",
  "auth/web-storage-unsupported": "BROWSER",
  "auth/operation-not-supported-in-this-environment": "BROWSER",
};

/** Solo el código del SDK: nunca el mensaje ni `customData`, que pueden llevar el correo. */
function sdkCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function errorCode(error: unknown): AuthErrorCode {
  const code = sdkCode(error);
  if (code.startsWith("auth/api-key-not-valid")) return "CONFIG";
  return CODES[code] ?? "UNKNOWN";
}

function outcomeOf(error: unknown): SignInOutcome {
  return CANCELLED.has(sdkCode(error)) ? { status: "cancelled" } : { status: "failed", code: errorCode(error) };
}

/** Nombre visible o nada: nunca el correo como respaldo. */
function accountOf(user: User): AuthUser {
  const name = user.displayName?.trim();
  return name ? { uid: user.uid, name } : { uid: user.uid };
}

/** Avisa fuera de la llamada en curso, como haría el SDK: quien se suscribe nunca recibe un error a mitad. */
function later(report: () => void) {
  void Promise.resolve().then(report);
}

export const firebaseAuth: (AuthSessionProvider & IdTokenSource) | undefined = {
  async getIdToken() {
    let current: Auth;
    try {
      current = currentAuth();
    } catch {
      return null;
    }
    const user = current.currentUser;
    if (!user) return null;
    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      // El error del SDK puede llevar el correo: no sale de aquí.
      return null;
    }
    // Si la cuenta cambió o se cerró mientras se pedía, ese token ya no es de quien está ahora.
    return current.currentUser?.uid === user.uid ? token : null;
  },

  subscribe(onUser, onError) {
    let current: Auth;
    try {
      current = currentAuth();
    } catch {
      later(() => {
        onError("CONFIG");
      });
      return () => undefined;
    }
    try {
      return onAuthStateChanged(
        current,
        (user) => {
          onUser(user ? accountOf(user) : null);
        },
        (error) => {
          onError(errorCode(error));
        },
      );
    } catch {
      later(() => {
        onError("UNKNOWN");
      });
      return () => undefined;
    }
  },

  signInWithGoogle() {
    // Sin esperas antes de abrir el popup: tiene que ocurrir dentro del gesto del usuario.
    let request: Promise<unknown>;
    try {
      const provider = new GoogleAuthProvider();
      // Dispositivo compartido: siempre se elige la cuenta.
      provider.setCustomParameters({ prompt: "select_account" });
      request = signInWithPopup(currentAuth(), provider);
    } catch (error) {
      return Promise.resolve(sdkCode(error) ? outcomeOf(error) : { status: "failed", code: "CONFIG" });
    }
    // La credencial se descarta: la cuenta llega por `subscribe`.
    return request.then(
      (): SignInOutcome => ({ status: "ok" }),
      (error: unknown) => outcomeOf(error),
    );
  },

  signOut() {
    try {
      return signOut(currentAuth()).catch(() => {
        throw new Error("no se pudo cerrar sesión");
      });
    } catch {
      return Promise.reject(new Error("no se pudo cerrar sesión"));
    }
  },
};

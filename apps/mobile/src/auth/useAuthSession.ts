import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthErrorCode, AuthSessionProvider, AuthUser, SignInOutcome } from "./session";

export interface AuthSession {
  /** `undefined` mientras el SDK no ha avisado; `null` sin sesión. */
  readonly user: AuthUser | null | undefined;
  /** No se pudo leer la sesión (configuración o SDK): se puede reintentar. */
  readonly failure?: AuthErrorCode;
  /** Popup de Google o cierre de sesión en curso. */
  readonly busy?: "signIn" | "signOut";
  /** Fallo de la última operación, con código seguro para mostrar. */
  readonly error?: AuthErrorCode;
  readonly signIn: () => void;
  readonly signOut: () => void;
  readonly retry: () => void;
  readonly clearError: () => void;
}

/** Operación de inicio o cierre de sesión vigente; un resultado de otra no toca nada. */
interface Operation {
  id: number;
  pending: boolean;
}

/**
 * Estado de la sesión sobre un proveedor inyectado. El popup se abre en el mismo gesto (sin esperas antes), un
 * segundo toque se ignora y los resultados obsoletos (tras desmontar, tras un cambio de cuenta avisado por el SDK o
 * de una operación anterior) se descartan. El mismo `uid` refrescado conserva el mismo objeto de usuario.
 */
export function useAuthSession(provider: AuthSessionProvider): AuthSession {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [failure, setFailure] = useState<AuthErrorCode>();
  const [busy, setBusy] = useState<"signIn" | "signOut">();
  const [error, setError] = useState<AuthErrorCode>();
  const [attempt, setAttempt] = useState(0);
  const operation = useRef<Operation>({ id: 0, pending: false });
  // Última cuenta avisada por el SDK, para comparar identidades fuera del render.
  const known = useRef<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const op = operation.current;
    const report = (code: AuthErrorCode) => {
      if (active) setFailure(code);
    };
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = provider.subscribe((next) => {
        if (!active) return;
        const previous = known.current;
        setFailure(undefined);
        if (previous && next && previous.uid === next.uid && previous.name === next.name) return;
        known.current = next;
        setUser(next);
        if (previous !== undefined && (previous?.uid ?? null) !== (next?.uid ?? null)) {
          // Otra cuenta (o ninguna): lo que estuviera en curso ya no aplica y su resultado se ignorará.
          op.id += 1;
          op.pending = false;
          setBusy(undefined);
          setError(undefined);
        }
      }, report);
    } catch {
      // Sin colgarse en «comprobando»: se informa fuera del efecto y se puede reintentar.
      void Promise.resolve().then(() => {
        report("UNKNOWN");
      });
    }
    return () => {
      active = false;
      op.id += 1;
      op.pending = false;
      unsubscribe();
    };
  }, [provider, attempt]);

  /** Empieza una operación si no hay otra; devuelve su id o `undefined` si se ignora el toque. */
  const begin = useCallback((kind: "signIn" | "signOut") => {
    const op = operation.current;
    if (op.pending) return undefined;
    op.id += 1;
    op.pending = true;
    setBusy(kind);
    setError(undefined);
    return op.id;
  }, []);

  const finish = useCallback((id: number, code?: AuthErrorCode) => {
    const op = operation.current;
    if (op.id !== id || !op.pending) return false;
    op.pending = false;
    setBusy(undefined);
    setError(code);
    return true;
  }, []);

  const signIn = useCallback(() => {
    const id = begin("signIn");
    if (id === undefined) return;
    let request: Promise<SignInOutcome>;
    try {
      request = provider.signInWithGoogle();
    } catch {
      request = Promise.resolve({ status: "failed", code: "UNKNOWN" });
    }
    request.then(
      (outcome) => {
        finish(id, outcome.status === "failed" ? outcome.code : undefined);
      },
      () => {
        finish(id, "UNKNOWN");
      },
    );
  }, [provider, begin, finish]);

  const signOut = useCallback(() => {
    const id = begin("signOut");
    if (id === undefined) return;
    let request: Promise<void>;
    try {
      request = provider.signOut();
    } catch (reason: unknown) {
      request = Promise.reject(reason instanceof Error ? reason : new Error("cierre de sesión fallido"));
    }
    request.then(
      () => {
        // Cerrar fue bien: no hay cuenta aunque el aviso del SDK llegue después.
        if (!finish(id)) return;
        known.current = null;
        setUser(null);
      },
      () => {
        finish(id, "SIGN_OUT_FAILED");
      },
    );
  }, [provider, begin, finish]);

  /**
   * Vuelve a leer la sesión. Abandona lo que estuviera en curso (p. ej. un popup abierto cuando falló la sesión): su
   * resultado tardío se ignora y Google vuelve a estar disponible en vez de quedarse esperando para siempre.
   */
  const retry = useCallback(() => {
    const op = operation.current;
    op.id += 1;
    op.pending = false;
    setBusy(undefined);
    setError(undefined);
    setFailure(undefined);
    setAttempt((current) => current + 1);
  }, []);

  const clearError = useCallback(() => {
    setError(undefined);
  }, []);

  return { user, failure, busy, error, signIn, signOut, retry, clearError };
}

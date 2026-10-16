import { useCallback, useEffect, useRef } from "react";

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Lanza peticiones que se cancelan al desmontar (cerrar sesión, cambiar de cuenta o de panel): su resultado nunca llega
 * a otra cuenta ni a un panel ya cerrado. Devuelve `undefined` si se canceló.
 */
export function useRequests() {
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, []);
  return useCallback(async <T>(call: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      return await call(controller.signal);
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return undefined;
      throw error;
    } finally {
      controllers.current.delete(controller);
    }
  }, []);
}

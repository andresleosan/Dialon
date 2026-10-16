import { createFirebaseVerifier, fetchGoogleKeys } from "./firebaseToken";
import { cleanupExpiredReceipts } from "./paymentRoutes";
import { handleRequest } from "./translate";

// Una instancia por isolate: la caché de claves de Google se comparte entre peticiones del mismo isolate.
const fetchOut = (url: string, init?: RequestInit) => fetch(url, init);
const verifier = createFirebaseVerifier({ loadKeys: (signal) => fetchGoogleKeys(fetchOut, signal) });

export default {
  fetch(request, env, ctx): Promise<Response> {
    return handleRequest(request, env, {
      verifier,
      fetch: fetchOut,
      waitUntil: (promise) => {
        ctx.waitUntil(promise);
      },
    });
  },
  // Limpieza de retención de comprobantes (90 días, solo aprobadas/rechazadas). NO hay ningún cron configurado en
  // `wrangler.jsonc` y, aunque se invoque, no hace nada salvo RECEIPT_PURGE_ENABLED === "true" (configurado "false").
  // Hoy solo se prueba en local con Miniflare. Activarlo en producción exige aprobar antes la política de retención.
  scheduled(controller, env, ctx): void {
    ctx.waitUntil(cleanupExpiredReceipts(env, controller.scheduledTime).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

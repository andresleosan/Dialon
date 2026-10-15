# Dialon — inicio de sesión con Google en web (Firebase Authentication)

Fecha: 2026-10-15. Base: `84b7a9e`. Decisiones revisadas por Root (`.tools/qa/firebase-20261015/reviewed-decisions.md`,
fuera de Git) sobre el diseño `.tools/qa/firebase-20261015/claude-auth-design.md`.

## Alcance

- **Incluido:** inicio y cierre de sesión con Google en la app web (Expo, `apps/mobile`) mediante Firebase
  Authentication (`signInWithPopup`), con la sesión gestionada por el SDK.
- **Excluido:** Analytics, Storage, Firestore, Hosting, Functions, Worker, verificación de ID tokens, `getIdToken`,
  backend, inferencia, despliegue y cambios en Firebase o en la nube.
- **Nativo:** sigue siendo la DEMO actual, sin Firebase en su bundle. Android con Google no está implementado
  (requisitos en «Límites»).
- **Cuenta y papeles:** una cuenta de Google por dispositivo compartido; A y B siguen siendo papeles de la
  conversación, no cuentas.

## Decisiones

| # | Decisión |
|---|---|
| D1 | El código lleva solo los cuatro campos públicos de cliente (`apiKey`, `authDomain`, `projectId`, `appId`). Sin `measurementId` ni Analytics. No son secretos. |
| D2 | `firebase@13.0.0` instalado solo en `apps/mobile` (lo instaló Root, con scripts desactivados). Solo se importan `firebase/app` y `firebase/auth`. |
| D3 | La DEMO local sigue usable sin cuenta. La pantalla inicial ofrece «Continuar con Google» (principal) y «Probar demo local» (secundaria); como invitado, la cabecera permite iniciar sesión después. Persistencia web por defecto del SDK, sin guardar tokens a mano. Nombre visible: `displayName` o «Cuenta de Google», nunca el correo. Iniciar sesión no protege la demo ni activa ningún backend. |

## Comportamiento

- **Comprobando sesión:**
  - Mientras el SDK no informa, se ve «Comprobando sesión…»; Google queda deshabilitado y la demo sigue disponible.
  - Si la configuración no arranca o falla la lectura de la sesión, se muestra un mensaje seguro con «Reintentar»
    y la demo. Nada se queda colgado ni falla en silencio.
- **Iniciar sesión:**
  - El toque llama a `signInWithPopup` sin ningún `await` ni import dinámico previo, para quedar dentro del gesto
    del usuario.
  - Mientras el popup está abierto, la conversación está desmontada (micrófono y reproducción liberados) y los
    botones deshabilitados. Un segundo toque se ignora.
  - Cancelar el popup vuelve sin aviso a donde se estaba (pantalla inicial o demo).
  - Errores con mensaje seguro, sin texto crudo, códigos, correos ni tokens: popup bloqueado, red, configuración,
    límite de intentos, cuenta deshabilitada, navegador no compatible y desconocido.
- **Sesión iniciada:**
  - La conversación se monta con `key = uid`. La cabecera muestra «Cerrar sesión» también en el teléfono; el nombre de la cuenta se oculta en pantallas pequeñas.
  - Mismo `uid` refrescado: se conserva la conversación. Otro `uid`: conversación nueva.
- **Cerrar sesión:**
  - Desmonta la conversación al instante; la limpieza existente al desmontar libera grabación, medidor, onda,
    reproducción y clip. Después llama a `signOut`.
  - Si falla, se remonta una conversación **nueva** con el aviso «No se pudo cerrar sesión…»; nunca revive el
    clip ni el estado anterior.
- **Resultados obsoletos:** se ignoran los de popups o cierres que lleguen tras desmontar, tras un cambio de sesión
  avisado por el SDK (otra pestaña, otra cuenta) o tras una operación más nueva. La suscripción se cancela al
  desmontar.
- **Intacto:** geometría, papeles marino/blanco, B girada entera, `VoiceWave`, captura y reproducción no cambian.
  Sin la acción de cabecera, la pantalla es idéntica a la anterior.

## Archivos

- `apps/mobile/src/auth/session.ts`: tipos portables (`AuthUser`, `AuthErrorCode`, `SignInOutcome`,
  `AuthSessionProvider`).
- `apps/mobile/src/auth/firebaseConfig.ts`: los 4 campos públicos.
- `apps/mobile/src/auth/firebaseAuth.web.ts`: adaptador web del SDK.
- `apps/mobile/src/auth/firebaseAuth.ts`: stub nativo (`undefined`).
- `apps/mobile/src/auth/useAuthSession.ts`: hook con guardas de obsolescencia.
- `apps/mobile/src/screens/AuthGate.tsx` y `SignInScreen.tsx`.
- Cambios pequeños: acción opcional `session` en la cabecera de `FaceToFaceScreen.tsx`, textos `AUTH` en `copy.ts`
  y el cableado en `App.tsx`.

## Pruebas

Todo en Jest, con el proceso real (hook, puerta, `FaceToFaceScreen`) y solo los efectos externos emulados: un
proveedor de sesión inyectado y los módulos `firebase/app` y `firebase/auth` simulados. Ninguna prueba contacta con
Firebase ni con Google, y no sirven como prueba de un inicio de sesión real.

## Límites

- **Inicio de sesión real con Google:** solo puede comprobarlo Luis en un origen autorizado: `localhost` (por
  ejemplo, con reenvío de puertos SSH) o `dialon.pages.dev` tras desplegar. El nombre de Tailnet no está autorizado.
- **Dominio de autenticación:** `authDomain` (`dialonapp.firebaseapp.com`) es otro sitio que la app; el popup es el
  flujo adecuado. No usar redirect sin un proxy de `/__/auth`. Safari y los bloqueadores de popups se comprueban a
  mano.
- **Persistencia:** la del SDK (IndexedDB) sobrevive a recargas y no está cifrada.
- **Android:** pendiente de `android.package`, una app Android registrada, huellas SHA-1/SHA-256,
  `google-services.json` (fuera de Git), un paquete nativo de Google Sign-In en un development build,
  `signInWithCredential` y persistencia nativa. Nada de eso existe todavía.
- **Sin backend:** no se envían ni verifican tokens; la clave pública de la API debería restringirse por referer en
  Google Cloud (tarea de Luis).

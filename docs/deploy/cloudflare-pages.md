# Prueba de la DEMO en Cloudflare Pages

Esta carpeta publica la app real de `apps/mobile`, exportada por Expo/Metro. No usa `.tools/qa-web`.
En web se graba y reproduce audio local real; la traducción sigue pendiente. Google usa Firebase Authentication,
y la demo local funciona sin cuenta. En nativo la escucha, traducción y voz siguen simuladas.

## Runtime y build

- Node **24.16.0** (`.node-version`).
- pnpm **10.34.6** (`packageManager`).
- Expo **57.0.26**, React/React DOM **19.2.3**, react-native-web **0.21.3** y @expo/metro-runtime **57.0.16**.
- Instalar desde la raíz del monorepo: `pnpm install --frozen-lockfile`.
- Comando desde la raíz: `pnpm build:web`.
- En este VPS, pnpm es local: `./.tools/pnpm/node_modules/.bin/pnpm build:web`.
- Carpeta generada: **`apps/mobile/dist`** (`index.html`, `_expo/` y metadata de exportación).

El script `scripts/build-web.mjs` ejecuta Expo offline, sin telemetry ni lectura de dotenv. Mantiene estado
Expo y temporales en `.tools/`; no necesita cuentas ni secretos para compilar. El bundle requiere JavaScript
y un origen seguro (HTTPS/localhost) para los UUID de `expo-crypto`.

## Parámetros para enlazar Pages

| Campo | Valor |
|---|---|
| Framework preset | None |
| Root directory | raíz del repositorio |
| Build command | `pnpm build:web` |
| Build output directory | `apps/mobile/dist` |
| `NODE_VERSION` | `24.16.0` |
| `PNPM_VERSION` | `10.34.6` |

Pages puede servir esta SPA desde `index.html`. No hay backend, Functions ni variables que configurar. El bundle
lleva la configuración **pública** de cliente de Firebase Authentication (`apiKey`, `authDomain`, `projectId`,
`appId` en `apps/mobile/src/auth/firebaseConfig.ts`): no son secretos. `dialon.pages.dev` debe seguir en los dominios
autorizados de Firebase Authentication para que el popup de Google funcione allí. La carpeta dist es generada y está fuera de Git. El enlace con Cloudflare y su
despliegue los realiza Luis; esta tarea no crea ni modifica recursos de Cloudflare.

## Límites

- El inicio de sesión con Google (popup) no protege la demo local ni ningún backend: todavía no se envían ni verifican
  tokens. No usar `signInWithRedirect` sin un proxy de `/__/auth` (el `authDomain` es otro sitio).
- No ejecuta traducción ni inferencia real. El Worker de traducción de texto (`apps/api`) existe en el repositorio pero
  **no está desplegado** ni enlazado con esta app; Pages sigue sin backend. Desplegarlo exige antes: DNS de IA Sarin,
  su esquema de autenticación (secreto solo en el Worker, cargado por Luis), un `namespace_id` de rate limit único,
  la URL pública del API y los orígenes CORS definitivos.
- La comprobación en navegador no valida Android, TalkBack o APK.
- Los avisos de dependencias y sus bloqueos están en `../verification/2026-10-13-auditoria-dependencias.md`.

Documentación oficial: [exportación Expo](https://docs.expo.dev/guides/publishing-websites/),
[build de Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[SPA en Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Publicación autorizada del panel (16 de octubre de 2026)

La web del panel necesita EXPO_PUBLIC_DIALON_API_URL con el origen HTTPS real de dialon-api al ejecutar pnpm build:web. El script admite únicamente esa variable pública adicional y no hereda secretos. Sin ella el build conserva el modo sin panel de cuenta. Validar que la URL aparece en el bundle antes de desplegar apps/mobile/dist.

El Worker de apps/api usa la configuración principal, las migraciones D1 0001–0004 y el R2 privado ya preparado. El CORS de producción permite únicamente https://dialon.pages.dev; el origen de desarrollo queda en la configuración local. El propietario se comprueba por UID/correo/verificación del JWT. Las tarifas/solicitudes de pago permanecen deshabilitadas y sin catálogo; RECEIPT_PURGE_ENABLED sigue false y no hay cron.

No publicar si falla un check. Antes de migrar: exportación D1 verificada y registro de versiones previas. La reversión inicial restaura la versión anterior del Worker y el deployment anterior de Pages, conservando las tablas y los datos de D1; no ejecutar rollback SQL destructivo sin exportación y revisión. Mantener los secretos existentes y no ejecutar inferencias ni activar suscripciones como prueba de despliegue.

Las limitaciones anteriores describen la DEMO previa a esta publicación. El resultado y las versiones efectivamente publicadas se documentarán en el informe de release.

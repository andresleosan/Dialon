# Prueba de la DEMO en Cloudflare Pages

Esta carpeta publica la app real de `apps/mobile`, exportada por Expo/Metro. No usa `.tools/qa-web`.
La escucha, traducción y voz siguen simuladas; los avisos DEMO permanecen visibles.

## Runtime y build

- Node **24.16.0** (`.node-version`).
- pnpm **10.34.6** (`packageManager`).
- Expo **57.0.26**, React/React DOM **19.2.3**, react-native-web **0.21.3** y @expo/metro-runtime **57.0.16**.
- Instalar desde la raíz del monorepo: `pnpm install --frozen-lockfile`.
- Comando desde la raíz: `pnpm build:web`.
- En este VPS, pnpm es local: `./.tools/pnpm/node_modules/.bin/pnpm build:web`.
- Carpeta generada: **`apps/mobile/dist`** (`index.html`, `_expo/` y metadata de exportación).

El script `scripts/build-web.mjs` ejecuta Expo offline, sin telemetry ni lectura de dotenv. Mantiene estado
Expo y temporales en `.tools/`; no necesita cuentas ni secretos para esta DEMO. El bundle requiere JavaScript
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

Pages puede servir esta SPA desde `index.html`. No hay backend, Functions, variables de cuenta o claves que
configurar para la DEMO. La carpeta dist es generada y está fuera de Git. El enlace con Cloudflare y su
despliegue los realiza Luis; esta tarea no crea ni modifica recursos de Cloudflare.

## Límites

- No autentica con Google/Firebase ni graba o reproduce audio.
- No ejecuta traducción ni inferencia real.
- La comprobación en navegador no valida Android, TalkBack o APK.
- Los avisos de dependencias y sus bloqueos están en `../verification/2026-10-13-auditoria-dependencias.md`.

Documentación oficial: [exportación Expo](https://docs.expo.dev/guides/publishing-websites/),
[build de Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[SPA en Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

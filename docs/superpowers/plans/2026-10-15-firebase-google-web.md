# Plan — inicio de sesión con Google en web

Especificación: [`../specs/2026-10-15-firebase-google-web.md`](../specs/2026-10-15-firebase-google-web.md).
Método TDD: primero pruebas, se guarda la salida roja y luego la verde (`.tools/qa/firebase-20261015/`, fuera de Git).

| # | Tarea | Archivos | Pruebas (rojo → verde) |
|---|---|---|---|
| 1 | Tipos portables del proveedor | `src/auth/session.ts` | — (solo tipos) |
| 2 | Hook de sesión: comprobando/sin sesión/con sesión; fallo de suscripción y reintento; ignorar dobles toques; cancelación silenciosa; errores; resultados obsoletos (desmontaje, cambio por el SDK, operación más nueva); cierre de sesión fallido; mismo `uid` conservado | `src/auth/useAuthSession.ts` | `src/auth/useAuthSession.test.ts` |
| 3 | Adaptador web del SDK: inicialización perezosa con los 4 campos; popup síncrono con `select_account`; tabla de códigos; usuario `{ uid, name }` sin correo ni tokens; errores de inicialización y suscripción sin lanzar | `src/auth/firebaseConfig.ts`, `src/auth/firebaseAuth.web.ts`, `src/auth/firebaseAuth.ts` | `src/auth/firebaseAuth.web.test.ts` (SDK simulado) |
| 4 | Acción de cuenta en la cabecera (opcional; sin ella, la salida no cambia) | `src/screens/FaceToFaceScreen.tsx`, `src/copy.ts` | `FaceToFaceScreen.test.tsx`: un caso nuevo |
| 5 | Puerta y pantalla inicial: nativo directo a la DEMO; demo de invitado e inicio de sesión desde ella; desmontaje inmediato al iniciar o cerrar sesión en PREPARING, RECORDING y reproducción; cierre fallido con estado nuevo; cambio de cuenta y refresco del mismo `uid`; popup obsoleto | `src/screens/AuthGate.tsx`, `src/screens/SignInScreen.tsx`, `App.tsx` | `src/screens/AuthGate.test.tsx` |
| 6 | Documentación mínima | `README.md`, `DESIGN.md`, `docs/deploy/cloudflare-pages.md` | — |
| 7 | Verificación completa | — | `pnpm test`, `typecheck`, `lint`, `build:web`; en el bundle, `firebase/auth` presente y sin Analytics, Firestore ni Storage |

Comandos (desde `/root/Dialon`):

```bash
apps/mobile/node_modules/.bin/jest --config apps/mobile/package.json apps/mobile/src/auth apps/mobile/src/screens/AuthGate.test.tsx apps/mobile/src/screens/FaceToFaceScreen.test.tsx
./.tools/pnpm/node_modules/.bin/pnpm test
./.tools/pnpm/node_modules/.bin/pnpm typecheck
./.tools/pnpm/node_modules/.bin/pnpm lint
./.tools/pnpm/node_modules/.bin/pnpm build:web
```

# Plan — traducción de texto con IA Sarin

Especificación: [`../specs/2026-10-15-sarin-text-translation.md`](../specs/2026-10-15-sarin-text-translation.md).
Base: `4a208b3`. Este es un cambio aparte del de Auth: sin commit, push, despliegue ni login.

## Reglas de trabajo

- **TDD:** en cada tarea, primero la prueba; se guarda la salida RED y luego la GREEN en `.tools/qa/sarin-20261015/`.
- **Dependencias (las instala Root, solo en el proyecto, con `--ignore-scripts`):**
  - `apps/api`: `jose@6.2.12`, `wrangler@4.148.0` (dev) y `miniflare@5.20261006.0-alpha` (dev, la misma de Wrangler).
  - `packages/api-client`: ninguna.
  - Sin `@cloudflare/vitest-pool-workers`: pide Vitest 4 y el repo usa Vitest 5.0.3.
  - `@cloudflare/workers-types` solo si `wrangler types` no basta.
- **Tras instalar:** revisar el esquema local de Wrangler (`ratelimits`, `compatibility_date`) y la API de opciones de
  Miniflare antes de escribir la configuración.
- **Pruebas sin red:**
  - Unitarias en Vitest 5 (Node 24: Web Crypto, `fetch` y `Request` nativos) con `fetch` y reloj inyectados.
  - Integración con workerd real mediante Miniflare, con todo el `fetch` saliente interceptado por `outboundService`
    (un host inesperado hace fallar la prueba).

## Tareas

| # | Tarea | Archivos | RED → GREEN (comportamiento observable) |
|---|---|---|---|
| 1 | Contratos de traducción de texto | `packages/contracts/src/translate.ts`, `index.ts` | `translate.test.ts`: petición válida; con `Limits` inyectados admite `pt`; `DEFAULT_LIMITS` rechaza `pt`; mismo idioma; UUID inválido; texto vacío/espacios; 2000 frente a 2001 caracteres; campos ajenos y `uid` descartados; resultado válido; `mode ≠ "real"`; traducción vacía o larga; tiempos negativos o no finitos |
| 2 | Andamiaje del Worker | `apps/api/{tsconfig.json,wrangler.jsonc}`, `scripts/api-tool.mjs` (Wrangler solo local: sin credenciales `CLOUDFLARE_*`/`CF_*` en el subproceso, XDG en `.tools/`, sin métricas, sin banner ni comprobación de actualizaciones, red bloqueada salvo loopback, `--dry-run` obligatorio) | `api-tool types` genera `Env` en `.tools/api/`; `wrangler types` genera `Env` con `TRANSLATE_LIMITER: RateLimit`; `wrangler deploy --dry-run --outdir .tools/tmp/api-bundle` sin login; `typecheck` incluye `apps/api` |
| 3 | Verificador de tokens | `apps/api/src/firebaseToken.ts` | `firebaseToken.test.ts` con un par RSA real generado en la prueba y JWT firmados con `SignJWT`: válido → `uid`; firma de otra clave; `kid` ausente o desconocido (una recarga y luego 401); `alg` HS256/none; `aud`/`iss` de otro proyecto; caducado → `TOKEN_EXPIRED`; `iat`/`auth_time` futuros o no numéricos; `sub` vacío o > 128; cabecera mal formada o > 4096; caché que respeta `max-age`, singleflight (2 verificaciones = 1 descarga), enfriamiento de 60 s; descarga lenta (plazo) o > 32 KiB → 503 |
| 4 | Llamada a Sarin | `apps/api/src/sarin.ts` | `sarin.test.ts` con `fetch` simulado: URL, modelo, `stream: false`, `redirect: "manual"` y cuerpo exactos; `unconfigured`/`bearer` sin clave → no hay `fetch`; `bearer` añade la cabecera y `none` no; éxito; `reasoning_content` ignorado; `<think>` en `content` → error; `length` → error; vacío o > 2000 → error; 3xx/401/403/429/500; HTML; JSON inválido; sin `choices`; cuerpo > 64 KiB; plazo → `TIMEOUT`; abort del cliente; una sola llamada en todos los fallos |
| 5 | Handler HTTP | `apps/api/src/{http.ts,translate.ts,index.ts}` | `translate.test.ts` con verificador, límite y `fetch` inyectados: 404/405; CORS y preflight con origen permitido y ajeno; sin token → 401 **y 0 llamadas** a Sarin; límite agotado → 429 sin `fetch`; binding ausente → 503; cuerpo de 16 KiB + 1 en streaming sin `Content-Length` → 413; no JSON → 400; `Content-Type` incorrecto → 415; `pt` aceptado por el catálogo del servidor; `TRANSLATION_LANGUAGES` inválido → 500; éxito con `timingsMs`; las respuestas y los logs capturados no contienen el texto, el token, `SARIN_API_KEY` ni el cuerpo del upstream |
| 6 | Integración con workerd real | `apps/api/test/worker.integration.test.ts` | Miniflare sobre el bundle del paso 2, con binding de límite real y `outboundService`: el JWKS servido como si fuera googleapis y Sarin simulado. Token válido → 200; inválido → 401 sin petición a Sarin; supera el límite → 429; sin `SARIN_AUTH_MODE` → 503; host inesperado → falla la prueba |
| 7 | Cliente portable | `packages/api-client/{package.json,tsconfig.json,src/index.ts}` | `index.test.ts`: petición inválida → sin token ni `fetch`; token `null` → `UNAUTHENTICATED` sin `fetch`; cabeceras y `redirect: "error"`; 200 válido; `requestId` distinto → `INVALID_RESPONSE`; `ApiError` del servidor; cuerpo inválido; red caída → `NETWORK`; abort antes del token, durante el token, durante el `fetch` y tras la respuesta → `AbortError` sin resultado; una sola llamada; sin logs; respuesta sin stream legible (sin `body`, sin `getReader` o con `getReader` que falla) → `INVALID_RESPONSE` sin llamar a `text()`/`json()`/`arrayBuffer()` |
| 8 | `getIdToken` en web | `apps/mobile/src/auth/{session.ts,firebaseAuth.web.ts}` + pruebas | Con el SDK simulado: sin usuario → `null`; con usuario → token; el usuario cambia durante la espera → `null`; el error del SDK no se filtra. Los proveedores falsos de las pruebas añaden `getIdToken`; la UI no cambia |
| 9 | Integración en el monorepo | `package.json` (scripts), `eslint.config.js` (ignorar `worker-configuration.d.ts`), `vitest.config.ts` | Vitest incluye solo `packages/**/src/**/*.test.ts` y `apps/api/**/*.test.ts` (nunca las pruebas Jest de `apps/mobile`); `typecheck` añade `apps/api` y `packages/api-client`; `test:api:integration` hace el bundle con dry-run y ejecuta Miniflare |
| 10 | Documentación mínima | `README.md`, `docs/deploy/cloudflare-pages.md` | Existe código del API, **sin desplegar**; Sarin no se ha verificado; no hay ASR |

## Regla → archivo → verificación

| Regla | Archivo | Verificación |
|---|---|---|
| Sin token válido no se llama a Sarin | `translate.ts` | T5 y T6: 0 llamadas salientes |
| Firma RS256, `kid`, `aud`/`iss` exactos y claims numéricos | `firebaseToken.ts` | T3: JWT reales y casos negativos |
| URL y modelo fijos, sin proxy ni redirecciones | `sarin.ts` | T4: cuerpo exacto y 3xx → error |
| Falla cerrado sin configuración de Sarin ni binding de límite | `translate.ts`, `sarin.ts` | T4, T5 y T6: 503 sin `fetch` |
| Topes de 16 KiB / 2000 caracteres / 64 KiB / 32 KiB y plazos | `http.ts`, `sarin.ts`, `firebaseToken.ts` | T3–T5 |
| Razonamiento y `length` no se presentan como éxito | `sarin.ts` | T4 |
| Sin fugas de texto, token ni secreto | todo `apps/api` | T5: respuestas y logs capturados |
| Catálogo configurable sin afirmar soporte de Sarin | `translate.ts` (contracts), `translate.ts` (api) | T1 y T5 |
| UI, audio y demo intactos | `apps/mobile` | Suite Jest completa en verde, sin cambios visuales |

## Verificación final (desde `/root/Dialon`, sin red)

```bash
./.tools/pnpm/node_modules/.bin/pnpm test
./.tools/pnpm/node_modules/.bin/pnpm test:api:integration
./.tools/pnpm/node_modules/.bin/pnpm typecheck
./.tools/pnpm/node_modules/.bin/pnpm lint
./.tools/pnpm/node_modules/.bin/pnpm build:web
```

Se guardan las salidas y los códigos de salida en `.tools/qa/sarin-20261015/final-*`. Hay que comprobar que el bundle
web no incluye `apps/api` ni ningún secreto.

## Fuera de este plan

- DNS de Sarin; esquema real de autenticación y carga del secreto (Luis, con `wrangler secret put`).
- `namespace_id` único, URL pública y orígenes CORS definitivos.
- Despliegue, login y la prueba real contra Sarin.
- Cualquier uso desde la UI.
- ASR.

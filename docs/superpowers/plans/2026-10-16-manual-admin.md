# Plan — administración manual y proveedores Sarin/DeepSeek

Especificación: [`../specs/2026-10-16-manual-admin.md`](../specs/2026-10-16-manual-admin.md). TDD: Root ejecuta las
pruebas con la red bloqueada y trae RED/GREEN.

## Pasada 1 (esta): pruebas RED, sin código de producto

| Archivo nuevo | Cubre | Fallo esperado hoy |
|---|---|---|
| `packages/contracts/src/translate.consent.test.ts` | Consentimiento booleano aceptado y conservado; no booleano, `provider`, `model`, `url` o `role` → `INVALID_REQUEST`; códigos nuevos | El parser estricto rechaza el campo; faltan los códigos |
| `apps/api/src/firebaseToken.claims.test.ts` | El verificador expone `email` y `emailVerified` de claims verificados | Hoy devuelve solo `{ ok, uid }` |
| `apps/api/src/sarin.access.test.ts` | Par de Cloudflare Access opcional que falla cerrado; cabeceras `CF-Access-Client-*` | Se ignora el par; no se envían cabeceras |
| `apps/api/src/admin.test.ts` | `/v1/me` sin token → 401; `/v1/admin/*` en cada método → 401/403 sin tocar D1; propietario incompleto → 403; cabeceras o cuerpo no dan rol; preflight `GET, POST, PUT`; independiente de Sarin | 404 |
| `apps/api/test/admin.integration.test.mjs` | workerd con D1/R2 locales: registro, suscripción manual, `SUBSCRIPTION_REQUIRED`, cuota atómica en paralelo, DeepSeek con externos y consentimiento, sin fallback, DeepSeek sin Sarin, `status` sin tráfico saliente, pagos desactivados por defecto | 404 en `/v1/me` y `/v1/admin/*` |
| `apps/api/test/support/local-d1.mjs` | Utilidad de prueba: aplica `apps/api/migrations/*.sql` si existen (hoy no) | — |
| `packages/api-client/src/me.test.ts` | `getMe()`: GET con token, validación, errores con mensaje fijo, sin red si la URL base falta | El método no existe (la promesa se rechaza) |

Las pruebas de UI (`?panel=admin`, `?panel=subscription`) se escriben en la pasada de UI, cuando existan los
componentes: hoy importarlos sería un error de preparación, no una RED.

## Pasada 2 (GREEN núcleo)

1. Contratos: códigos nuevos y consentimiento; tipos y parsers de `MeResponse` y de las respuestas admin.
2. `firebaseToken.ts` devuelve `email` y `emailVerified`. Sarin Access. `deepseek.ts` con su `deepseek.test.ts` (fetch
   simulado).
3. `migrations/0001_manual_admin.sql`, `store.ts` (D1), `router.ts` (`/v1/me`, `/v1/admin/*`) y `translate.ts` con
   suscripción, cuota, proveedor y consentimiento.
4. Adaptar las pruebas existentes que asumían traducción sin suscripción (`translate.test.ts`,
   `worker.integration.test.mjs`) sembrando una suscripción activa, sin debilitar ninguna aserción.
5. `api-client`: `getMe` y los métodos admin.
6. `wrangler.jsonc` (cuenta, `workers_dev: true`, vars) y `wrangler.local.jsonc` con D1/R2 locales. Comprobar que
   Miniflare no deja estado fuera de `.tools/`.

## Pasada 3: comprobantes (fase 2)

Pruebas RED: firma mágica y MIME, 5 MiB, vacío/HTML/SVG, autorización entre usuarios, `idempotencyKey`, aprobación
única, objeto huérfano, sin sobrescribir y retención de 90 días con `scheduled`. Después, la implementación.

Estado (2026-10-16): implementado tras la revisión (cadena retenida con `waitUntil`, `onlyIf`, barrido de huérfanos,
tope de 400 días, idempotencia antes de los ajustes). Pruebas: `apps/api/src/receipts.test.ts`,
`apps/api/test/receipts.integration.test.mjs`, `packages/api-client/src/payments.test.ts` y
`packages/contracts/src/payments.test.ts`. Verificado por Root: 387 pruebas, 22 integraciones y recorrido de navegador local pasan.

## Pasada 4: UI

Componentes `AdminPanel` y `SubscriptionPanel` en `?panel=…`, solo con la URL del API configurada; rol solo desde
`/v1/me`. Pruebas Jest (`apps/mobile/src/account/AccountScreen.test.tsx`) y QA headless sin red. Estado: verificado por Root; 15 comprobaciones de navegador, seis configuraciones de pantalla y cinco capturas revisadas.

## Pendiente antes de producción

- UID real verificado por Firebase MCP y preparado en la configuración principal; el archivo local de pruebas conserva el vacío. Sin desplegar.
- D1/R2 privados aprobados y creados; 90 días aceptados como diseño. Migraciones remotas, guarda de purga y cron siguen pendientes.
- `EXPO_PUBLIC_DIALON_API_URL` sigue vacía: la app publicada no llama al API.
- DeepSeek solo con los modelos `deepseek-flash` y `deepseek-v4-pro`. Gemini no tiene adaptador ni se usa.
- Entrada a los paneles verificada desde «Mi suscripción» en `AuthGate` cuando hay API configurada; `FaceToFaceScreen` sigue intacta.

## Verificación

```bash
./.tools/pnpm/node_modules/.bin/pnpm test
./.tools/pnpm/node_modules/.bin/pnpm test:api:integration
./.tools/pnpm/node_modules/.bin/pnpm typecheck
./.tools/pnpm/node_modules/.bin/pnpm lint
```

En RED, `typecheck` y `lint` pueden fallar en las pruebas nuevas; en GREEN se exige verde.

Evidencia final: [verificación de la fase local](../../verification/2026-10-16-manual-admin.md).

Preparación aprobada y recursos: [estado verificado](../../deploy/2026-10-16-preparacion-recursos.md).

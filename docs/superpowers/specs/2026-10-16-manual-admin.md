# Dialon — proveedores Sarin/DeepSeek, administración manual y solicitudes de transferencia

Fecha: 2026-10-16. Base: `4a208b3` más los cambios Sarin sin versionar (se conservan). Implementación y QA local con Miniflare D1/R2. Tras aprobación posterior se crearon D1/R2 privados y se prepararon sus bindings, sin migraciones remotas ni despliegue. Gemini excluido. El login con Google (`SignInScreen`, SDK de Firebase), la
conversación, el audio y el core no cambian.

## Proveedor de traducción (solo lo controla el propietario, en el backend)

- **Proveedores:** `sarin` (por defecto) o `deepseek`, en el ajuste `translation.activeProvider` de D1, que solo cambia
  el propietario. **Sin fallback**: si el activo falla, la petición falla.
- **DeepSeek exige dos cosas:** `translation.externalProvidersEnabled === true` (ajuste del propietario, `false` por
  defecto) y `externalProcessingConsent === true` en cada petición (si no, 403 `CONSENT_REQUIRED`, sin llamar).
  - El consentimiento no elige proveedor.
  - Si el proveedor activo es Sarin, el consentimiento se acepta y se ignora.
  - Guardar `deepseek` con los externos deshabilitados → 400.
- **El cliente no puede enviar** `provider`, `model`, `url`, `messages`, `role` ni similares (petición estricta → 400).
- **Topes que se mantienen en `/v1/translate`:** Firebase JWT, CORS, rate limit, 16 KiB de cuerpo, 2000 caracteres,
  64 KiB de upstream leído por stream, 25 s en el Worker y 35 s en el cliente, `redirect: "manual"` sin seguir, y
  ningún log de texto, tokens, uid ni claves.
- **Sarin** (configuración independiente; DeepSeek funciona sin `SARIN_AUTH_MODE`):
  - `SARIN_AUTH_MODE` ∈ {`none`, `bearer`}.
  - Par opcional `SARIN_ACCESS_CLIENT_ID`/`SARIN_ACCESS_CLIENT_SECRET` → cabeceras `CF-Access-Client-Id`/`-Secret`.
  - Un par incompleto → `unconfigured` (falla cerrado). Nunca se leen valores reales.
- **DeepSeek:**
  - URL fija `https://api.deepseek.com/chat/completions`.
  - `DEEPSEEK_MODEL` ∈ {`deepseek-flash`, `deepseek-v4-pro`}; cualquier otro valor → no configurado (503).
  - Cuerpo `{ model, stream: false, thinking: { type: "disabled" }, temperature: 0, max_tokens: 1024, messages }`.
  - `Authorization: Bearer DEEPSEEK_API_KEY` (secreto solo del backend, ya en el dashboard; aquí no se toca).
  - Respuesta: mismos topes que Sarin. `reasoning_content` se ignora; `<think>` en `content` o `length` → error.

## Propietario

- **Es propietario solo si** se cumplen todas: JWT Firebase RS256 válido (verificador actual), `email_verified === true`,
  `email` (en minúsculas) igual a `OWNER_EMAIL` (`andres.san1404@gmail.com`) y `sub === OWNER_FIREBASE_UID`, que debe
  ser no vacío.
- **`OWNER_FIREBASE_UID` permanece vacío en `wrangler.local.jsonc`**. El UID real se verificó después con Firebase MCP y está preparado en el archivo principal, sin desplegar. Las pruebas usan un uid ficticio y tokens sintéticos.
- **Nada da el rol** salvo eso: ni ser el primer usuario, ni claims o cabeceras del cliente, ni rutas escondidas. Sin
  credenciales de Admin SDK ni claims personalizados.
- **El verificador expone** `{ uid, email?, emailVerified }`, siempre de claims verificados.
- **Cada ruta y método `/v1/admin/*`** comprueba el rol después del token y antes de tocar D1: sin token → 401; no
  propietario → 403.
- **Frontend:** nunca decide el rol por el email; solo muestra lo que devuelve `GET /v1/me`.

## Persistencia (D1 `DB`, local)

| Tabla | Contenido |
|---|---|
| `users` | `uid` (PK, del token), `email` (del token verificado), `created_at`, `last_seen_at`. Se registra en `GET /v1/me`; no es el directorio de Firebase |
| `subscriptions` | `uid` (PK), `status` (`active`/`suspended`/`inactive`), `plan`, `period_start`, `expires_at`, `max_requests`, `max_chars`, `used_requests`, `used_chars`, `updated_at` |
| `settings` | `key` → JSON validado (`translation`, `payments`) |
| `provider_status` | `provider`, `last_success_at`, `last_failure_at` (solo de peticiones reales de usuarios; nunca pruebas automáticas) |
| `audit` | `at`, `actor_uid`, `action`, `target_uid`, sin contenido de conversación |
| `maintenance_cursors` | Cursores opacos de la limpieza local, sin datos de usuario ni conversación |
| `payment_requests` (fase 2) | `id` (generado por el servidor), `uid`, `plan`, `amount`, `currency`, `status` (`pending`/`approved`/`rejected`), `idempotency_key` (UNIQUE con `uid`), `proof_key`, `proof_mime`, `proof_bytes`, `proof_uploaded_at`, `decided_at` |

- **Usuario nuevo:** `inactive`, sin acceso a la traducción. Nada de acceso provisional ni de 24 h.
- **Orden en cada traducción:** token → límite por ubicación (no es cuota global) → cuerpo → suscripción `active` y
  `expires_at > ahora` (si no, 403 `SUBSCRIPTION_REQUIRED`) → proveedor configurado (503) → consentimiento si es
  DeepSeek (403 `CONSENT_REQUIRED`) → **reserva atómica de cuota** → llamada.
  - La reserva es un único `UPDATE … WHERE status = 'active' AND expires_at > ? AND used + n <= max`, comprobando
    `changes === 1`. Si falla → 429 `QUOTA_EXCEEDED`, sin llamar al proveedor.
  - Si la llamada al proveedor ya salió, la cuota queda consumida.
- **Límites del propietario:** validados, con topes duros: `max_requests` ≤ 100 000, `max_chars` ≤ 10 000 000 y
  vencimiento ≤ 400 días. Nunca llegan del cuerpo de un usuario.
- **Contratos** (aditivo): códigos `SUBSCRIPTION_REQUIRED`, `QUOTA_EXCEEDED` y `CONSENT_REQUIRED`;
  `externalProcessingConsent?: boolean` en `TextTranslationRequest`.

## API (JSON estricto, `Cache-Control: no-store`)

| Ruta | Quién | Efecto |
|---|---|---|
| `GET /v1/me` | autenticado | Registra o actualiza el usuario y devuelve `{ uid, role: "owner"\|"user", subscription: { status, plan, expiresAt, limits, usage }, payments: { enabled, currency, instructions, plans } }`. Un vencido se informa como `expired` |
| `GET /v1/admin/users` | propietario | Usuarios con su suscripción |
| `PUT /v1/admin/users/:uid/subscription` | propietario | `{ status, plan, expiresAt, limits }`, validado; una renovación reinicia el uso del periodo; queda en `audit` |
| `GET` / `PUT /v1/admin/settings` | propietario | `{ translation: { activeProvider, externalProvidersEnabled }, payments: { enabled, currency, instructions, prices: { weekly, biweekly, monthly } } }` |
| `GET /v1/admin/status` | propietario | Por proveedor: `configured`, `state` (`not_configured`/`unverified`/`verified`) y `lastSuccessAt`. **Nunca** hace una petición saliente |

CORS: los mismos orígenes; el preflight concede `GET, POST, PUT` y `Authorization, Content-Type`.

## Fase 2: solicitudes de transferencia y comprobantes (R2 `PROOFS` privado, local)

- **Pagos:** catálogo por país `{ enabled, markets }`, apagado y vacío por defecto (detalle en
  [country-currency-retention](2026-10-16-country-currency-retention.md)). Cada país tiene su moneda, instrucciones y
  precio y cuota de los tres planes; activar exige al menos un país completo. La tarifa global anterior ya no existe y
  se lee como apagada. No se copian precios, datos bancarios, contactos ni marca de ninguna referencia. Sin prueba
  gratuita.
- **Planes:** semanal (7 d), quincenal (14 d) y mensual (30 d, etiquetado «30 días»), elegidos explícitamente.
- **Rutas** (implementadas en local; contrato en `packages/contracts/src/payments.ts`):
  - `POST /v1/me/payment-requests` con `{ country, plan, idempotencyKey }` (UUID): 201 nueva, 200 si la clave ya existe
    con el mismo país y plan, 409 con otro país/plan o con otra pendiente (una por usuario en todos los países). El
    servidor copia país, importe, moneda, días y cuota de la tarifa de ESE país; sin tarifa, 409. La
    clave se busca **antes** de leer los ajustes: un reintento devuelve lo creado aunque luego se desactiven los pagos;
    la configuración actual solo decide solicitudes nuevas (409 `PAYMENTS_DISABLED`). No activa nada.
  - `GET /v1/me/payment-requests` (10 por defecto, 20 máx.) y `GET /v1/admin/payment-requests?status=` (25/50).
  - `PUT /v1/me/payment-requests/:id/receipt`: cuerpo binario. `GET …/:id/receipt` (autor) y
    `GET /v1/admin/payment-requests/:id/receipt` (propietario). Otra cuenta → 404.
  - `POST /v1/admin/payment-requests/:id/{approve,reject}`.
- **Aprobación:** un único `batch` condicional con un nonce del servidor. Exige `pending`, comprobante disponible y que
  `max(ahora, vencimiento) + días ≤ ahora + 400 días`; si no, 409 sin cambiar estado, suscripción ni auditoría. La
  renovación y su auditoría se aplican una sola vez (`grant_applied_at`), aunque se repita la aprobación o el nonce.
  Aprobar tras rechazar, o al revés, → 409.
- **Comprobante:**
  - Como máximo 5 MiB, leídos por stream; solo PDF (`%PDF-`), JPEG (`FF D8 FF`) o PNG (`89 50 4E 47 0D 0A 1A 0A`), y el
    MIME declarado debe coincidir con la firma. Vacío, HTML o SVG → 400; otro tipo → 415; mayor → 413.
  - Clave generada por el servidor `receipts/<ms de subida, 13 dígitos>-<uuid>` (nunca el nombre del cliente), escrita
    solo si no existe (`onlyIf`). Un segundo comprobante para la misma solicitud → 409.
  - Una sola cadena put → asociar → limpiar, retenida con `ctx.waitUntil`: si la petición se cancela (504) la cadena
    sigue. Solo se borra un objeto que esta subida creó y que con certeza no quedó asociado; si es incierto, se conserva
    y lo recoge la retención.
  - Descarga autenticada con `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, CSP `sandbox` y
    `no-store`. Nunca hay URL pública; nunca pasa por IA ni por logs.
- **Retención propuesta:** 90 días desde la subida. Después, el acceso se deniega (410) y `scheduled` (solo invocado en
  local; **sin cron**) borra objeto y referencia, y también los objetos huérfanos con formato de la app, de más de 90
  días y sin referencia en D1. Los metadatos mínimos de la decisión se conservan. Se confirma antes de crear recursos
  reales. Los cursores de D1 y R2 se conservan entre ejecuciones: un objeto que no se pueda borrar no impide alcanzar páginas posteriores; al terminar un barrido se reinicia el cursor.
- **Migración:** `0004_payment_country.sql` añade `payment_requests.country` (NULL en el historial) y amplía
  `settings.value` a 131072 caracteres copiando las filas; su rollback (`rollback/0004_payment_country.down.sql`) falla
  sin tocar `settings` si algún valor supera 4096. `0003_retention_cursors.sql` añade los cursores y el índice de vencimiento/id, con rollback separado. `0002_payment_receipts.sql`, rollback manual en `apps/api/rollback/0002_payment_receipts.down.sql`.
- **Nunca** se guardan conversaciones ni audio en D1/R2.

## UI (implementada en local, `apps/mobile/src/account/`)

- **Componentes separados**, en el mismo origen de Pages: `?panel=admin` («Administración») y `?panel=subscription`
  («Mi suscripción»), con sesión iniciada. Paleta marino/blanco, ≥ 48 px, foco visible y etiquetas visibles.
- **Entrada desde la conversación:** con el API configurado, `AuthGate` ofrece «Mi suscripción» y permite volver a la conversación; `FaceToFaceScreen` permanece intacta.
- **Acceso:** «Administración» solo aparece y se dibuja si `GET /v1/me` dice `role: "owner"`; nunca por email ni uid en
  el frontend. La seguridad está en el backend. La pantalla se monta con `key = uid` y cancela sus peticiones al salir.
- **URL pública del API sin configurar por defecto** (`EXPO_PUBLIC_DIALON_API_URL`): sin ella no hay cliente ni
  llamadas, y `?panel=` solo explica que el servicio no está configurado.
- **Estado de proveedores:** histórico, «Respuesta válida registrada» / «Sin prueba registrada», con fechas; no es
  salud actual y abrir el panel no llama a ningún proveedor.
- **Comprobante:** selector de archivos y descarga solo en web (`*.web.tsx`); en nativo se explica.
- **Sin cambios** en `SignInScreen`, `FaceToFaceScreen`, el SDK de Firebase, audio, tema, iconos ni textos existentes.
  La conversación sigue siendo DEMO; no hay ASR.

## Configuración preparada, sin desplegar

La configuración principal contiene el UID verificado y los bindings `DB` y `PROOFS` de los recursos privados autorizados.
Las migraciones remotas no están aplicadas. `wrangler.local.jsonc` conserva recursos ficticios y UID vacío. El API publicado
no ha cambiado. No hay cron ni regla de expiración R2 de comprobantes aceptados. La retención de 90 días está aceptada
como diseño; antes de una purga real faltan confirmar el alcance e implementar una guarda desactivada por defecto con
previsualización sin borrado. No publicar ni ejecutar limpieza remota todavía.

Datos y evidencia de preparación: [recursos y propietario verificados](../../deploy/2026-10-16-preparacion-recursos.md).


## Regla de pendientes acordada para la propuesta

Las solicitudes **pendientes** deben conservar su comprobante disponible para revisión, sin caducidad de acceso ni purga automática mientras sigan pendientes. Esta exclusión queda incorporada a la propuesta; el código local actual todavía selecciona por vencimiento sin distinguir estado y deberá adaptarse antes de producción. No activar cron, reglas de expiración ni limpieza real con ese código. Para las solicitudes resueltas, confirmar antes de activar la política cómo se trata una revisión posterior a los 90 días desde `uploadedAt`, evitando que una decisión desencadene un borrado inmediato no revisado. La purga permanece sin activar y no se ha borrado nada.

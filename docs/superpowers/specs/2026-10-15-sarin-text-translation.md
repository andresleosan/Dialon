# Dialon — traducción de texto con IA Sarin (Worker mínimo + cliente)

Fecha: 2026-10-15. Base: `4a208b3` (Auth web comprometido). Aprobado por el usuario: implementar sin desplegar, sin
login, sin push ni commit, sin secretos reales ni accesos persistentes. Parte de
`.tools/qa/sarin-20261015/sarin-backend-proposal.md`, corregida con las decisiones de Root.

## Alcance

- **Incluido:** Worker `apps/api` con solo `POST /v1/translate` (texto → texto), tipos y parsers nuevos en
  `packages/contracts`, cliente portable `packages/api-client` y `getIdToken` en la sesión web. Todo probado sin red.
- **Excluido:** ASR, streaming, cambios de UI/selector/copy/audio, llamadas desde la app, despliegue, `wrangler login`,
  rutas, secretos reales, servicios de datos (KV, D1, R2, DO, colas) y Firebase Admin o revocación.
- **Sin verificar:** el DNS de `ia-sarin.alsdevstudio.com` (no resuelve) y la autenticación, el modelo, la forma de
  respuesta, el razonamiento, la latencia y la calidad de Sarin en cualquier idioma. El código queda probado contra un
  upstream simulado; no es una integración con Sarin en marcha.

## Decisiones de Root (prevalecen; `.tools/qa/sarin-20261015/root-reviewed-decisions.md`)

| Tema | Decisión |
|---|---|
| Esquema | La petición nueva es **estricta**: rechaza propiedades ajenas (`uid`, `url`, `model`, `messages`…). `parseTurnMeta` y `TurnResult` no cambian. |
| Catálogo | `DEFAULT_TEXT_TRANSLATION_LIMITS` (es, en, pt, fr, de, it), compartido por el parser nuevo, el Worker y el cliente; `DEFAULT_LIMITS` sigue siendo es/en. Ningún idioma está validado contra Sarin. |
| Claves de Google | `max-age` sin mínimo artificial; `no-store`/`no-cache` → 0; se descuenta `Age`; máximo 24 h. Singleflight, ≤ 32 KiB, 5 s y enfriamiento de 60 s. **Nunca** se usan claves caducadas. |
| Compatibilidad | `compatibility_date: 2026-10-06` (coincide con workerd 1.20261006.1), en configuración y en Miniflare. |
| Plazos | Worker: 25 s en total (auth, cuerpo y upstream; claves ≤ 5 s). Cliente: 35 s en total (token, `fetch` y lectura), respuesta ≤ 16 KiB. Aborto del usuario → `AbortError`; plazo propio → `TIMEOUT`. |
| Mensajes | El cliente solo expone códigos conocidos con mensajes fijos; nunca reenvía mensajes remotos. |
| Entorno | `Env` lo genera `wrangler types` (en `.tools/`, ignorado). El secreto opcional se lee con `"SARIN_API_KEY" in env` + `typeof`. Sin `.env`/`.dev.vars`. |
| Límite | Clave = `translate:` + `uid` verificado; el `namespace_id` es un candidato local. Sin binding o si falla → 503. |
| Intacto | UI, audio, copy, core, `App.tsx` y `useAuthSession` quedan idénticos byte a byte (hashes de Root). |

## Contratos (`packages/contracts`, aditivo)

```ts
interface TextTranslationRequest { requestId: string; source: LanguageCode; target: LanguageCode; text: string }
interface TextTranslationResult {
  requestId: string; translation: string; mode: "real";
  timingsMs?: Partial<Record<"auth" | "translate" | "total", number>>;
}
parseTextTranslationRequest(input: unknown, limits?: Limits): ParseResult<TextTranslationRequest>
parseTextTranslationResult(input: unknown, limits?: Limits): ParseResult<TextTranslationResult>
```

- **Petición (estricta):** solo `requestId`, `source`, `target` y `text`; cualquier otra propiedad (`uid`, `url`,
  `model`, `messages`…) → `INVALID_REQUEST`. `requestId`/`source`/`target` se validan con `parseTurnMeta(input,
  limits)` (UUID, catálogo de `limits`, distintos); `text` es un string no vacío tras `trim` y ≤ `limits.maxTextChars`.
- **Resultado:** solo `mode: "real"`, que viene del servidor; los tiempos son finitos y ≥ 0.
- **Sin cambios:** `DEFAULT_LIMITS` (es/en), `TurnResult` y los códigos de error.
- **Catálogo del servidor:** por defecto, `DEFAULT_TEXT_TRANSLATION_LIMITS` (los seis idiomas).
  - Se puede ampliar o recortar con la variable `TRANSLATION_LANGUAGES`, separada por comas y validada por
    `createLimits`; si no es válida, el Worker falla cerrado con `INTERNAL`.
  - Aceptar un idioma **no** acredita que Sarin lo soporte ni su calidad.

## API HTTP (`apps/api`)

- **Petición:** `POST /v1/translate` con `Content-Type: application/json`, `Authorization: Bearer <Firebase ID token>`
  y cuerpo `TextTranslationRequest`.
- **200:** `TextTranslationResult`.
- **Errores:** forma `ApiError` existente, `{ error: { code, message }, requestId? }`.
  - `requestId` solo se incluye si ya se validó.
  - Mensajes genéricos fijos que nunca contienen texto, token, secreto ni el cuerpo del upstream.
  - Cabeceras: `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.

| Situación | HTTP | Código |
|---|---|---|
| Ruta desconocida / otro método | 404 / 405 (`Allow: POST, OPTIONS`) | `INVALID_REQUEST` |
| `Origin` presente y no permitido | 403 | `FORBIDDEN` |
| Token ausente, mal formado o inválido; claves sin `kid` correspondiente | 401 | `UNAUTHENTICATED` |
| Token caducado | 401 | `TOKEN_EXPIRED` |
| Límite por `uid` superado | 429 + `Retry-After` | `RATE_LIMITED` |
| Falta el binding de límite, Sarin sin configurar, claves de Google inaccesibles | 503 | `SERVICE_UNAVAILABLE` |
| Cuerpo > 16 KiB, no JSON, `Content-Type` incorrecto, contrato inválido | 413 / 400 / 415 / 400 | `INVALID_REQUEST` |
| Idioma fuera del catálogo o par igual | 400 | `UNSUPPORTED_LANGUAGE` |
| Upstream 429 | 503 | `BUSY` |
| Upstream con timeout o plazo agotado | 504 | `TIMEOUT` |
| Upstream 3xx/401/403/5xx/otro, HTML, JSON inválido, forma inesperada, razonamiento en `content`, `finish_reason: "length"`, salida vacía o > `maxTextChars` | 502 | `SERVICE_UNAVAILABLE` |
| Error no previsto | 500 | `INTERNAL` |

**CORS:** `OPTIONS` devuelve 204 solo si el origen está en `ALLOWED_ORIGINS` (lista exacta separada por comas). Solo
`POST`, y solo las cabeceras `Authorization` y `Content-Type`. Una petición sin `Origin` (no navegador) sigue
necesitando token.

## Flujo del Worker (orden estricto; sin token válido no hay `fetch` a Sarin)

1. Ruta y método; origen.
2. Configuración: `SARIN_AUTH_MODE` ∈ {`none`, `bearer`}. Si falta o tiene otro valor, se trata como `unconfigured`
   y se responde 503.
   - `bearer` sin `SARIN_API_KEY`, o con ella vacía, también cuenta como `unconfigured`.
   - Nunca hay inferencia anónima por omisión.
3. Token: `Authorization: Bearer`, ≤ 4096 caracteres, verificado como en la sección siguiente. El `uid` sale solo de
   `sub`.
4. Límite: `env.TRANSLATE_LIMITER.limit({ key: uid })`. Si falta el binding o lanza, 503 (falla cerrado).
5. Cuerpo: `Content-Length` > 16 KiB se rechaza al momento; el stream se lee con tope de 16 KiB aunque no haya
   `Content-Length`, y con plazo. Luego `JSON.parse` seguro y `parseTextTranslationRequest(serverLimits)`.
6. Sarin:
   - Plazo total de unos 25 s con `AbortSignal.any([AbortSignal.timeout(…), request.signal])`.
   - Lectura de la respuesta con tope de 64 KiB.
   - Una sola llamada: **ningún reintento**.
7. 200 con `{ requestId, translation, mode: "real", timingsMs: { auth, translate, total } }`.

**Logs:** como mucho, una línea con `requestId` (si es válido), código, estado del upstream y duraciones. Nunca texto,
traducción, tokens, `uid`, cabeceras ni cuerpos.

## Verificación del Firebase ID token (`src/firebaseToken.ts`)

- **Proyecto fijo en el código:** `dialonapp`. `issuer` = `https://securetoken.google.com/dialonapp` y `audience` =
  `dialonapp`, exactos.
- **Claves:** el JWKS oficial `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
  (Root comprobó que responde 200 con los mismos 4 `kid` que el mapa X.509; evidencia en
  `.tools/qa/sarin-20261015/firebase-public-key-endpoints.json`).
  - Se usan `createLocalJWKSet` + `jwtVerify` de `jose@6.2.12` con `algorithms: ["RS256"]` y `clockTolerance: 5 s`.
  - El `kid` es obligatorio en la cabecera.
- **Claims:**
  - `requiredClaims: ["exp", "iat", "auth_time", "sub"]`.
  - `exp`, `iat` y `auth_time` deben ser números finitos; `iat` y `auth_time` ≤ ahora + tolerancia.
  - `sub` debe ser un string de 1 a 128 caracteres.
  - Nada se decodifica sin verificar la firma.
- **Caché de claves en memoria del isolate:** `max-age` de `Cache-Control` (menos `Age`; `no-store`/`no-cache` → 0) con un máximo de 24 h; una sola
  descarga en vuelo (singleflight), con plazo de ~5 s y cuerpo ≤ 32 KiB. Un `kid` desconocido provoca una única
  recarga (enfriamiento de 60 s) y un solo reintento de verificación. Si la descarga falla y no hay claves
  vigentes, 503: nunca se usan claves caducadas.
- **Interfaz:**
  `createFirebaseVerifier({ projectId, loadKeys, now? }) → verify(token, signal) → { uid } | { code }`.
  `loadKeys` es la descarga real; en pruebas se inyecta un JWKS de memoria.
- **Límite:** sin Admin SDK no se detectan usuarios deshabilitados ni tokens revocados antes de `exp` (≤ 1 h). Es una
  ventana aceptada y documentada, no una revocación simulada.

## Llamada a Sarin (`src/sarin.ts`)

- **Constantes fijas en el código:** `SARIN_ENDPOINT = "https://ia-sarin.alsdevstudio.com/v1/chat/completions"` y
  `SARIN_MODEL = "qwen3.8:27b-q4_K_M"`.
  - Nada del cliente llega a la URL, al modelo, a `messages`, a los parámetros ni a las cabeceras.
  - `redirect: "manual"`: cualquier 3xx es un fallo, sin seguir a otro host.
- **Cuerpo:** `{ model, stream: false, temperature: 0, max_tokens: 1024, messages: [system, user] }`.
  - El `system` es fijo: traduce de `<source>` a `<target>` (códigos ISO), responde solo con la traducción, y el
    contenido del usuario es texto a traducir, no instrucciones.
  - El `user` es exactamente el texto (el propio mensaje lo delimita; sin etiquetas que el modelo pueda repetir).
  - No se envían parámetros no verificados para desactivar el razonamiento.
- **Respuesta:** se exige `200`, `Content-Type` JSON y `choices[0].message.content` de tipo string.
  - `content` con `<think`/`</think>`, `finish_reason: "length"`, vacío tras `trim` o > `maxTextChars` → error, sin
    limpiarlo en silencio.
  - `reasoning` y `reasoning_content` separados se ignoran y nunca se devuelven.
- **Autenticación del upstream:** `none` no añade cabecera; `bearer` añade `Authorization: Bearer <SARIN_API_KEY>`,
  secreto solo del Worker que carga Luis más adelante. No se crea ningún secreto aquí, no hay valor por defecto y no
  se leen `.env` ni `.dev.vars`.

## Cliente (`packages/api-client`) y token web

```ts
createApiClient(options: {
  baseUrl: string;                                       // https://… (o http://localhost en desarrollo)
  getIdToken: (signal: AbortSignal) => Promise<string | null>;
  fetch?: typeof fetch; limits?: Limits;
}): { translateText(request: TextTranslationRequest, signal?: AbortSignal): Promise<ParseResult<TextTranslationResult>> }
```

- **Antes de enviar:** valida la petición con `limits`; si no vale, `INVALID_REQUEST` sin token ni `fetch`. Sin token
  (`null`), `UNAUTHENTICATED` sin `fetch`.
- **Envío:** `POST` con `redirect: "error"`.
- **Lectura:** solo del stream `Response.body` (con `getReader` utilizable), trozo a trozo y con tope de 16 KiB. Sin
  stream legible → `INVALID_RESPONSE` sin llamar a `text()`/`json()`/`arrayBuffer()` ni fiarse de `Content-Length`.
  Requisito: un `fetch` con `Response.body` legible (navegadores, Node, Workers). Un `fetch` nativo sin streaming
  necesitaría un adaptador propio con un límite real, que no existe todavía; no se promete compatibilidad con React
  Native.
- **Respuesta:** el 200 se valida con `parseTextTranslationResult`, y además el `requestId` debe coincidir; si no,
  `INVALID_RESPONSE`. Lo demás pasa por `parseApiError` (si no vale, `INVALID_RESPONSE`). Un fallo de transporte da
  `NETWORK`.
- **Cancelación:** si se aborta antes, durante o después de pedir el token o el `fetch`, se rechaza con `AbortError`
  y nunca entrega un resultado viejo.
- **Sin** reintentos, caché ni logs de token o texto.
- **Token web:** `IdTokenSource.getIdToken(): Promise<string | null> (interfaz separada de AuthSessionProvider)` con `auth.currentUser?.getIdToken()`, que
  devuelve `null` si el usuario cambió durante la espera. Nativo sigue sin proveedor; la UI no lo usa todavía.

## Límites y riesgos

- **Sin DNS ni autenticación confirmados:** no hay llamada real. La latencia de un 27B puede superar los 25 s
  (`TIMEOUT`), y si el modelo razona dentro de `content`, todo fallará cerrado hasta configurar ese comportamiento con
  datos reales.
- **Límite por `uid`:** el binding de Rate Limiting es por ubicación y no es una cuota global exacta. El
  `namespace_id` local es solo un candidato y hay que confirmar que es único antes de cualquier despliegue.
- **Compatibilidad:** `compatibility_date: 2026-10-06`, decidida por Root, coincide con `workerd 1.20261006.1`.
- **Cancelación:** cancelar en el cliente aborta el `fetch`, pero puede no detener el cómputo en Sarin.
- **Orígenes:** `ALLOWED_ORIGINS` local es provisional (`https://dialon.pages.dev`, `http://localhost:8081`); el
  definitivo se decide al desplegar.

# Dialon — verificación local de traducción de texto con Sarin

Fecha: 2026-10-15. Proyecto: `/root/Dialon`. Base y HEAD: `4a208b3e56a2a9bce3b2514d9185240f429c517f`.
La integración Sarin queda en cambios locales sin commit, push ni despliegue. Especificación:
[`2026-10-15-sarin-text-translation.md`](../superpowers/specs/2026-10-15-sarin-text-translation.md);
plan: [`2026-10-15-sarin-text-translation.md`](../superpowers/plans/2026-10-15-sarin-text-translation.md).
Evidencia ejecutable y salidas: `.tools/qa/sarin-20261015/` (ignorado por Git).

## Resultado implementado

No existía backend en este repositorio. Se añadió el Worker mínimo de Cloudflare previsto por la arquitectura y un cliente de texto separado, sin conectar la interfaz ni cambiar el flujo de audio.

- `apps/api`: `POST /v1/translate`, destino fijo `https://ia-sarin.alsdevstudio.com/v1/chat/completions`, modelo fijo `qwen3.8:27b-q4_K_M`. Sin URL/modelo elegibles por el cliente ni proxy arbitrario.
- Firebase: verificación criptográfica RS256 con `jose`, claves públicas oficiales y comprobación de firma, `kid`, emisor, audiencia, caducidad, `iat`, `auth_time` y sujeto. El uid proviene del token verificado. No se llama a inferencia sin autenticación válida.
- Validación estricta, texto de entrada/salida ≤ 2.000 caracteres; petición ≤ 16 KiB y respuesta upstream ≤ 64 KiB. Worker con plazo total de 25 s; cliente con plazo de 35 s, incluyendo token y lectura, y respuesta ≤ 16 KiB. Sin reintentos automáticos.
- CORS por lista permitida; límite por uid de 10 peticiones/60 s; respuestas de error controladas. Los logs propios solo registran requestId validado, código, estado y duración: sin textos, uid, tokens ni claves.
- Sarin queda cerrado por defecto hasta elegir su modo de autenticación explícitamente. No se configuró ninguna clave real.
- `packages/contracts`: contrato aditivo de texto con catálogo por defecto es/en/pt/fr/de/it e inyección de otros idiomas ISO. Ningún idioma se ha validado con el modelo real. El catálogo es/en del flujo previo se conserva.
- `packages/api-client`: cliente con fetch y token inyectados, validación, correlación requestId y cancelación. Requiere `Response.body` con lectura por bloques; adaptadores sin streaming se rechazan sin llamar a `text()`, `json()` o `arrayBuffer()`. La compatibilidad con un fetch nativo sin streaming requiere otro adaptador con un límite real, aún no implementado.
- `IdTokenSource` se añadió separado de `AuthSessionProvider`. El proveedor web obtiene el ID token vigente y devuelve null si cambia la cuenta durante la espera. La UI no llama al nuevo cliente ni al getter.

## Comprobaciones y evidencia

| Comprobación | Resultado | Evidencia en QA |
|---|---|---|
| Suite completa | **299 pasan: 158 Vitest + 141 Jest**, exit 0 | `review-final-test.txt`, `.exit` |
| Integración en workerd real | **4 pasan**, exit 0; bundle real y todo el tráfico saliente interceptado | `review-final-test-api-integration.txt`, `.exit` |
| Verificación independiente de Root | **12/12 PASS** sobre el bundle real, sin destinos externos inesperados | `independent-runtime-result.json`, `independent-runtime-check.mjs` |
| Typecheck | exit 0, cinco proyectos TypeScript y tipos de Worker generados | `review-final-typecheck.txt`, `.exit` |
| Lint | exit 0 | `review-final-lint.txt`, `.exit` |
| Build web | exit 0, bundle de 746 KB | `review-final-build-web.txt`, `.exit` |
| Build Worker | exit 0, solo dry-run: 52,17 KiB / gzip 14,27 KiB | `review-final-build-api.txt`, `.exit` |
| Integridad | 26 archivos UI/audio/core protegidos sin cambios; índice sin cambios; HEAD conservado | `root-final-integrity.json` |
| Revisión de código independiente | Único hallazgo importante corregido; sin otros hallazgos críticos/importantes | `root-code-review-summary.json` |
| Dependencias | 0 críticas; persisten las mismas 2 altas + 2 moderadas anteriores | `dependency-audit-sarin-remediated.json` |

Los 12 casos independientes cubren idioma adicional configurado (ja→fr), audiencia incorrecta, ausencia de auth_time/iat, token caducado, firma RSA alterada, campos URL/modelo rechazados, redirección upstream no seguida, razonamiento no devuelto, respuesta upstream excesiva, origen no permitido y falta de token. Los tokens son sintéticos, firmados con claves generadas en memoria; Sarin y JWKS están simulados. Las fuentes Worker/contratos coinciden con las usadas en esta verificación.

La revisión detectó que el fallback a `response.text()` comprobaba el tamaño después de descargarlo completo. La regresión falló primero (RED exit 1) y pasó tras eliminar el fallback (GREEN exit 0): cuerpos ausentes, sin getReader o con getReader que lanza se rechazan sin lectura, incluso con Content-Length engañoso. Evidencia: `review-client-red.*` y `review-client-green.*`.

El nuevo advisory de sharp introducido por Miniflare se corrigió mediante override acotado `miniflare>sharp: 0.35.5`. La auditoría conserva cuatro advisories previos de Expo/React Native (uuid, node-forge, braces y sprintf-js), por lo que **la auditoría no está limpia** y devuelve exit 1. No se instalaron dependencias globales.

Los comandos Wrangler se limitaron a generar tipos, construir con `deploy --dry-run` y pruebas locales. Subproceso sin credenciales Cloudflare, configuración/cache en `.tools`, telemetría desactivada y conexiones Node limitadas a loopback; en workerd los destinos salientes se interceptan por separado. No se inició sesión ni se crearon recursos de Cloudflare. Los dos endpoints públicos de claves Firebase respondieron 200 y sus kids coincidieron; esto no equivale a un login real.

## Límites de lo comprobado y siguiente paso

La única comprobación DNS final fue a **2026-10-15 04:43:20 UTC**, mediante getaddrinfo desde el VPS: **sin dirección asociada al hostname** (`dns-final-resolution.json`). El usuario informó de un cambio DNS y prevé propagación para mañana. No se cambió DNS ni se repitieron peticiones HTTP.

Siguen pendientes la autenticación real de Sarin, disponibilidad del modelo, formato/razonamiento de su respuesta, latencia y calidad de idiomas. No hay inferencia real ni login Google real en estas pruebas. Este endpoint es chat/texto: **no hay ASR ni traducción del audio grabado**.

El siguiente paso mínimo, cuando resuelva el DNS, es confirmar el modo de autenticación de Sarin y realizar una llamada de texto sintético. Si requiere un secreto, el usuario debe introducirlo por el mecanismo seguro del servicio, fuera del chat. Antes de un futuro despliegue quedan por confirmar cuenta/ruta/URL de Cloudflare y unicidad del namespace_id propuesto. Cualquier publicación se revisa aparte.

El límite por uid es por ubicación de Cloudflare, no una cuota global. Sin Admin SDK, los tokens revocados/cuentas deshabilitadas pueden seguir aceptados hasta expirar (normalmente hasta una hora). La cancelación del cliente no garantiza detener un cómputo ya iniciado en Sarin.

## Auth: commit listo y push manual

Auth ya está en el commit `4a208b3e56a2a9bce3b2514d9185240f429c517f`, con autor/committer andresleosan (`andres.san1404@gmail.com`). El push automático anterior falló con 403 por credenciales de otra cuenta; no se modificaron helpers ni credenciales.

Ejecutar **una vez en una terminal interactiva del VPS**, introduciendo allí el token de GitHub de la cuenta autorizada si Git pide contraseña:

```bash
env -u GIT_ASKPASS -u SSH_ASKPASS -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=1 git -C /root/Dialon -c credential.helper= -c credential.username=andresleosan -c core.askPass= -c http.extraHeader= push https://andresleosan@github.com/andresleosan/Dialon.git 4a208b3e56a2a9bce3b2514d9185240f429c517f:refs/heads/main
```

Este comando no se ha ejecutado. Omite helpers/configuración global para esa invocación, no guarda credenciales y empuja el SHA exacto de Auth sin force; los cambios locales Sarin no se incluyen. Incluye los commits anteriores que forman parte de su historia. Se comprobó sin red que helper y extraHeader efectivos quedan vacíos y el usuario es andresleosan: `auth-manual-push-verification.json`.

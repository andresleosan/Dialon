# Dialon: país, moneda y retención segura — alcance local autorizado

La solicitud continúa el flujo existente de administración y suscripciones. No se publica, no se migra D1 remoto, no se activa cron/purga, no se fijan precios ni instrucciones bancarias reales. Se preservan Firebase, login, audio y proveedores.

## Retención
Pendientes con comprobante conservan descarga autor/owner y disponibilidad aunque hayan pasado 90 días, y siguen pudiendo aprobarse manualmente. Solo approved/rejected pueden caducar según uploadedAt + 90 días. cleanupExpiredReceipts falla cerrado salvo RECEIPT_PURGE_ENABLED === "true"; main/local config quedan "false". previewExpiredReceipts es una función interna local de lectura acotada que devuelve {expiredReceipts, orphanReceipts, hasMore}; no agrega endpoints ni UI, ni escribe cursores, referencias u objetos. Los huérfanos siguen las validaciones previas. La aprobación de política y el encendido real siguen separados.

## País y moneda
- El usuario elige explícitamente el país antes de pedir suscripción. El locale puede sugerir una región explícita con Intl.Locale.region; nunca maximize(), idioma→país, GPS, IP ni servicios externos. "es"/"en" no dan país.
- La selección se puede corregir para viajes/idioma. Opciones mínimas: Colombia CO, Jersey JE, países del catálogo y región sugerida; un país sin precio queda sin oferta ni creación. No hay fallback a otro país/moneda.
- payments pasa de una tarifa global a {enabled, markets: [...]}. Cada mercado tiene country (dos letras mayúsculas, único), currency (ISO válida), instructions, prices y planLimits para weekly/biweekly/monthly. Catálogo vacío/off por defecto. Solo el owner configura importes. Datos globales antiguos NO se asignan automáticamente a un país: lectura conservadora off/vacía hasta configuración explícita.
- GET /v1/me devuelve el catálogo público validado con países, monedas e instrucciones/planes para elegir localmente. Máximo 20 mercados; respuestas/settings/cuerpos acotados a 128 KiB, suficientes para instrucciones limitadas de esos mercados; conservar otros límites existentes.
- POST de solicitud exige {country, plan, idempotencyKey}. El servidor consulta su mercado y congela país, moneda, importe, duración y cuota. No acepta precio, moneda ni cambio del cliente. Reintento mismo key + país + plan devuelve snapshot incluso tras desactivar/cambiar catálogo; distinto país/plan con el mismo key da conflicto.
- Una solicitud/comprobante existente muestra su snapshot y no cambia al cambiar país o precios. Una pendiente sigue siendo única por usuario en todos los países.
- 0004_payment_country.sql añade country nullable para preservar historial antiguo sin inventarle país; vista legacy country:null con etiqueta sin país registrado. Todas las solicitudes nuevas guardan country validado. Rollback separado. Solo migración local en pruebas.
- Admin usa los paneles existentes: editar un mercado por país, moneda e importes reales en unidad mayor (sin separadores de miles), transferencias y cuotas. No se prellenan precios ni bancos. CO sugiere COP, JE GBP, con moneda explícita del catálogo.
- Intl.NumberFormat con currencyDisplay:"code" muestra COP/GBP inequívocos. El exponente de moneda viene de Intl/ISO; no dividir por 100 universalmente. Entrada decimal exacta→entero seguro menor, sin parseFloat, cambio de símbolo ni conversión FX. Probar COP, GBP, JPY (0) y KWD (3).
- Cambiar país invalida el plan/intento de solicitud nueva; no modifica ni quita comprobantes o solicitudes guardados.

## Secuencia y evidencia
1. Terminar RED/GREEN de retención ya iniciado con Claude CLI en su sesión existente.
2. Pruebas RED de contratos/API/cliente y UI para catálogo, país, importes, locale ambiguo, ausencia de precio, snapshots e idempotencia. Root ejecuta las pruebas sin red.
3. Implementar cambios mínimos y adaptar fixtures existentes conservando sus aserciones de seguridad.
4. Revisar seguridad y validar tipos/lint, pruebas afectadas, integración local y web build. QA móvil CO/COP y JE/GBP, país sin tarifa, cambio de país y solicitud previa congelada; sin inferencia ni documentos reales.
5. Entregar capturas actualizadas y estado listo para autorización de publicación. Ningún commit/push/deploy ni migración remota.

## Detalle del editor de precios
Cambiar la moneda de un mercado vacía sus precios: el propietario debe introducir importes nuevos; nunca se reutiliza el mismo entero con otro símbolo o exponente. Añadir otro país comienza sin precios ni instrucciones bancarias; no se clona una tarifa existente. Las solicitudes previas conservan su snapshot.

## Corrección verificada del exponente monetario

Las pruebas encontraron COP0 por defecto en ICU78.3 y Chromium153. El almacenamiento y parseo usan unidades menores ISO4217 explícitas y compartidas, procedentes de SIX List One2026-09-17, con soporte de Intl validado; Intl formatea con ambos límites de decimales explícitos. No se deriva el exponente de sus valores por defecto. Referencia: docs/verification/2026-10-16-currency-units.md.

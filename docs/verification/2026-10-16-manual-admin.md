# Dialon: país, moneda y retención verificados

16 de octubre de 2026 (UTC). Cambios locales en /root/Dialon, HEAD 4a208b3e56a2a9bce3b2514d9185240f429c517f; índice vacío. Sin commit, push, despliegue, cron ni migraciones remotas.

## Resultado

La web dispone de Administración y Mi suscripción con permisos decididos por el backend. El propietario se valida por UID, correo y correo verificado del JWT Firebase. Puede gestionar suscripciones/cuotas, elegir Sarin o DeepSeek y revisar comprobantes privados. Solicitar o subir un comprobante no activa acceso: requiere aprobación manual. Los planes duran7, 14 y 30 días.

Las tarifas se configuran por país, moneda e importe real. El usuario elige explícitamente su país; navigator.languages solo aporta una sugerencia de región explícita. No se usan GPS, IP, maximize, geolocalización externa ni conversión FX. CO/COP y JE/GBP están probados. en-GB sugiere GB; no se confunde con Jersey. Sin tarifa para un país no se ofrece ni crea una solicitud.

El propietario edita importes en unidad mayor. Cambiar moneda vacía los tres precios para introducirlos de nuevo; añadir país empieza vacío. El servidor valida y congela país, plan, días, moneda, importe y cuotas. Cambiar selección o catálogo conserva las solicitudes y sus comprobantes. Los reintentos con la misma clave/país/plan devuelven el snapshot; otro país o plan produce conflicto. Solo hay una pendiente por usuario.

Los códigos COP/GBP se muestran explícitamente. Las pruebas detectaron COP 0 en el valor predeterminado de ICU/Chromium. Se corrigió fijando las unidades menores de ISO 4217/SIX (lista publicada 2026-09-17) y pasando los decimales explícitos a Intl. COP/GBP: 2, JPY: 0, KWD: 3; sin valor 2 por defecto para moneda desconocida. Fuente y hash: [unidades monetarias](2026-10-16-currency-units.md), [SIX List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml).

Los valores reales por defecto siguen siendo pagos apagados y catálogo vacío: sin tarifas, banco ni instrucciones inventados. Todas las tarifas, usuarios y comprobantes de las capturas son FICTICIOS. NO TRANSFERIR DINERO.

## Retención

Una solicitud pendiente conserva su comprobante descargable y puede aprobarse aunque hayan pasado 90 días. Solo aprobadas/rechazadas dejan de estar disponibles al cumplir 90 días desde uploadedAt. La purga exige la cadena exacta RECEIPT_PURGE_ENABLED="true"; ambos wrangler.jsonc mantienen "false" y no contienen cron.

previewExpiredReceipts es de solo lectura, acotada, devuelve contadores agregados y hasMore; no borra objetos ni referencias ni escribe cursores. No se añadió endpoint ni UI de mantenimiento. No se ha ejecutado purga remota.

## Evidencia final

- 254 pruebas Vitest + 172 Jest = 426: pasan.
- 42 integraciones en workerd/Miniflare con D1/R2 en memoria: pasan.
- Typecheck, ESLint y build web: pasan.
- Chromium 153 headless: 17 comprobaciones y 6 revisiones de geometría a 320/393/1440 px, con texto ampliado al 200%; sin desbordamiento horizontal, controles de 48 px y último control alcanzable.
- Navegador/API sintéticos: cero peticiones externas inesperadas y cero llamadas de inferencia.
- Migración0004/rollback en SQLite en memoria: 8 comprobaciones, datos previos y metadatos del comprobante preservados, country:null en historial, catálogo grande admitido, rollback de catálogo mayor a 4096 falla antes de tocar datos/país; rollback pequeño y reaplicación válidos.
- Revisión independiente de retención, país/moneda y corrección ISO: sin Critical/Important verificables.
- Hashes: 23 archivos protegidos de login, auth, audio/core, conversación y diseño intactos; migraciones 0001–3 y ambos wrangler intactos respecto a su baseline previo. git diff --check limpio.

Los JWT/JWKS, usuarios, PDF e importes de QA son sintéticos. Se probaron componentes, cliente y Worker reales; Firebase, traducción y almacenamiento remoto no se invocaron. Las capturas son detalles completos de secciones en ancho móvil o escritorio. No se usó una sesión de Google real para producirlas.

Evidencia en .tools/qa/admin-local-20261016/country-*-green*.log y .exit; .tools/qa/country-currency-20261016/{ui-e2e-result,migration-result,scope-result,iso-reference}.json.

## Recursos preparados previamente con aprobación

Cuenta Cloudflare AndresLeoSan (05fb22c155667de064b55c4e287b21d8).

- D1 dialon-db: 214e3bbd-541d-4acc-a3e2-bed6247876f6, EEUR; última consulta: 0 tablas.
- R2 dialon-proofs: EEUR Standard; última consulta: 0 objetos, r2.dev desactivado y sin dominios públicos.
- Se mantiene únicamente la regla de fábrica para abortar multipart incompleto a 7 días; no hay expiración 90d de objetos aceptados.
- UID Firebase 57bGIuBCzKNFqjP8XrkP0T7jJP82, andres.san1404@gmail.com, emailVerified:true y disabled:false, verificado con Firebase oficial en dialonapp.

La configuración principal local apunta a esos recursos; no se publicó. No se activaron planes de pago ni inferencias. El gasto real y las alertas de cuenta no se auditaron en esta fase.

## Pendiente

La migración nueva0004 añade country nullable y amplía settings copiando las filas antes de sustituir la tabla. Su rollback requiere exportación previa: quitar country perdería el país de solicitudes nuevas. Ninguna migración se aplicó al D1 real.

Sarin sigue pendiente de autenticación/prueba real: la comprobación previa sin credenciales encontró Cloudflare Access 403. DeepSeek tampoco se llamó realmente. Las credenciales deben introducirse mediante los mecanismos del proveedor/servidor cuando se autorice esa fase. La conversación por voz sigue en DEMO.

Siguiente paso mínimo: revisar las capturas y definir tarifas e instrucciones reales por país. Migraciones y publicación requieren autorización aparte y los checks de despliegue correspondientes. La purga permanece apagada.

# Recursos Dialon preparados

16 de octubre de 2026. Preparación aprobada: D1 dialon-db (214e3bbd-541d-4acc-a3e2-bed6247876f6, EEUR) y R2 dialon-proofs (EEUR Standard, privado) en cuenta AndresLeoSan. Última consulta: D1 sin tablas, R2 sin objetos, r2.dev desactivado y sin dominios públicos. UID Firebase verificado: 57bGIuBCzKNFqjP8XrkP0T7jJP82, andres.san1404@gmail.com, emailVerified:true, disabled:false.

El wrangler principal local contiene esos bindings y UID; el local mantiene identificadores ficticios para QA. Ambos conservan RECEIPT_PURGE_ENABLED="false", sin cron. No se publicaron cambios ni se aplicaron migraciones remotas.

Las migraciones 0001–0004 y sus rollback separados están preparados. La0004 conserva el historial con país null y copia ajustes antes de ampliar el límite. Rollback requiere exportación y no admite catálogos mayores de4096 sin resolverlos con el propietario.

País/moneda y retención están implementados y verificados localmente. Véase [verificación final](../verification/2026-10-16-manual-admin.md) para resultados, capturas, fuente ISO y pendientes. Tarifas/banco/instrucciones reales siguen vacíos o desactivados. Sarin requiere resolver Access 403 y prueba autenticada posterior.

El paquete de preparación contiene configuraciones sin secretos, migraciones/rollback, recursos no secretos, reportes y capturas ficticias.

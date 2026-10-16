-- Rollback MANUAL de migrations/0001_manual_admin.sql. No está en la carpeta de migraciones a propósito: Wrangler y
-- las pruebas nunca lo aplican solo. Borra TODOS los datos de administración (usuarios propios, suscripciones, ajustes,
-- estado, auditoría y solicitudes). Antes de usarlo fuera de local: exportar la base y confirmarlo con el propietario.
-- En R2 (fase 2) los comprobantes no se borran con esto: hay que borrarlos aparte.

DROP INDEX IF EXISTS payment_requests_by_status;
DROP TABLE IF EXISTS payment_requests;
DROP TABLE IF EXISTS audit;
DROP TABLE IF EXISTS provider_status;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS users;

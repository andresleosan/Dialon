-- Sólo desarrollo/local. Deshacer 0003 antes de 0002 y 0001; se pierde únicamente el progreso del barrido.
DROP INDEX IF EXISTS payment_requests_retention_scan;

DROP TABLE IF EXISTS maintenance_cursors;

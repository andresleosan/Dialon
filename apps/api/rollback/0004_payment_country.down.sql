-- Rollback MANUAL de migrations/0004_payment_country.sql. Fuera de la carpeta de migraciones a propósito.
-- Deshacer 0004 antes que 0003, 0002 y 0001. ANTES: exportar la base (incluye los ajustes y el país de las solicitudes).
--
-- Seguridad de datos:
-- * `settings` vuelve al tope de 4096 caracteres COPIANDO las filas a una tabla nueva. Si algún valor (p. ej. un
--   catálogo grande por país) supera 4096, el INSERT viola el CHECK y se detiene ANTES de tocar `settings`: la tabla
--   original queda intacta. Nunca se trunca ni se borra un catálogo. En ese caso, eliminar `settings_0003_rollback`
--   (vacía) y decidir con el propietario antes de reintentar.
-- * Quitar `payment_requests.country` pierde el país congelado de las solicitudes nuevas: hacerlo solo con la
--   exportación hecha. Los ajustes por país que queden se leerán como pagos apagados (forma desconocida = restrictiva).

CREATE TABLE settings_0003_rollback (
  key TEXT PRIMARY KEY CHECK (key IN ('translation', 'payments')),
  value TEXT NOT NULL CHECK (length(value) <= 4096),
  updated_at INTEGER NOT NULL
);

INSERT INTO settings_0003_rollback (key, value, updated_at) SELECT key, value, updated_at FROM settings;

DROP TABLE settings;

ALTER TABLE settings_0003_rollback RENAME TO settings;

ALTER TABLE payment_requests DROP COLUMN country;

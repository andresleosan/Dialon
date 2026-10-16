-- Dialon: precios por país (solo local por ahora). No reescribe 0001–0003 ni convierte datos antiguos.
-- Rollback documentado en apps/api/rollback/0004_payment_country.down.sql (fuera de esta carpeta: no se aplica solo).
-- Una sentencia por bloque terminado en ';' al final de línea; sin triggers ni BEGIN/COMMIT.

-- País congelado de cada solicitud nueva. NULL solo en el historial anterior: no se le inventa un país.
ALTER TABLE payment_requests ADD COLUMN country TEXT CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]');

-- `settings.value` pasa de 4096 a 131072 caracteres (catálogo de hasta 20 países). SQLite no cambia un CHECK en su
-- sitio: se crea la tabla nueva con las mismas columnas y restricciones, se COPIAN todas las filas tal cual (sin
-- convertir los ajustes antiguos) y solo entonces se sustituye la original.
CREATE TABLE settings_0004 (
  key TEXT PRIMARY KEY CHECK (key IN ('translation', 'payments')),
  value TEXT NOT NULL CHECK (length(value) <= 131072),
  updated_at INTEGER NOT NULL
);

INSERT INTO settings_0004 (key, value, updated_at) SELECT key, value, updated_at FROM settings;

DROP TABLE settings;

ALTER TABLE settings_0004 RENAME TO settings;

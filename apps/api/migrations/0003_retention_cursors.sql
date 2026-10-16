-- Cursores de mantenimiento para avanzar aunque falle un lote o se agote el presupuesto.
-- No contiene datos de usuarios ni contenido de comprobantes.
CREATE TABLE IF NOT EXISTS maintenance_cursors (
  scan TEXT PRIMARY KEY CHECK (scan IN ('receipts-db', 'receipts-r2')),
  cursor TEXT CHECK (cursor IS NULL OR length(cursor) <= 4096),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_requests_retention_scan
  ON payment_requests(receipt_expires_at, id) WHERE proof_key IS NOT NULL;

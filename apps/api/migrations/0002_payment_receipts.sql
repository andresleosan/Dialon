-- Dialon: solicitudes por transferencia y comprobantes privados (solo local por ahora).
-- Rollback documentado en apps/api/rollback/0002_payment_receipts.down.sql (fuera de esta carpeta).
-- Una sentencia por bloque terminado en ';' al final de línea; sin triggers.

-- Copia del servidor al crear la solicitud: duración y cuota del plan (el importe y la moneda ya estaban en 0001).
ALTER TABLE payment_requests ADD COLUMN days INTEGER CHECK (days IS NULL OR days IN (7, 14, 30));

ALTER TABLE payment_requests ADD COLUMN max_requests INTEGER CHECK (max_requests IS NULL OR (max_requests BETWEEN 1 AND 100000));

ALTER TABLE payment_requests ADD COLUMN max_chars INTEGER CHECK (max_chars IS NULL OR (max_chars BETWEEN 1 AND 10000000));

-- Retención del comprobante: subida + 90 días. Pasada la fecha se deniega la descarga y la limpieza lo borra.
ALTER TABLE payment_requests ADD COLUMN receipt_expires_at INTEGER;

ALTER TABLE payment_requests ADD COLUMN receipt_purged_at INTEGER;

-- Nonce del servidor de la decisión que ganó: la renovación solo se aplica si la fila lleva ESTE nonce.
ALTER TABLE payment_requests ADD COLUMN decision_nonce TEXT;

-- Marca de renovación aplicada: la renovación y su auditoría solo se aplican mientras sea NULL (una vez por solicitud,
-- aunque se repitiera el mismo nonce).
ALTER TABLE payment_requests ADD COLUMN grant_applied_at INTEGER;

-- Como mucho una solicitud pendiente por usuario, garantizado por la base (sin carreras).
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_one_pending ON payment_requests (uid) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS payment_requests_by_uid ON payment_requests (uid, created_at);

CREATE INDEX IF NOT EXISTS payment_requests_receipt_expiry ON payment_requests (receipt_expires_at) WHERE proof_key IS NOT NULL;

-- Barrido de huérfanos en R2: comprobar si una clave sigue referenciada.
CREATE INDEX IF NOT EXISTS payment_requests_proof_key ON payment_requests (proof_key) WHERE proof_key IS NOT NULL;

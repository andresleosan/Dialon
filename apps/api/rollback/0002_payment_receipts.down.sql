-- Rollback MANUAL de migrations/0002_payment_receipts.sql. Fuera de la carpeta de migraciones a propósito.
-- ANTES: borrar en R2 los objetos referenciados por `proof_key` (este SQL no toca R2) y exportar la base.
-- Aplicar después de este, si se quiere volver al estado anterior a 0001, rollback/0001_manual_admin.down.sql.

DROP INDEX IF EXISTS payment_requests_proof_key;
DROP INDEX IF EXISTS payment_requests_receipt_expiry;
DROP INDEX IF EXISTS payment_requests_by_uid;
DROP INDEX IF EXISTS payment_requests_one_pending;
ALTER TABLE payment_requests DROP COLUMN grant_applied_at;
ALTER TABLE payment_requests DROP COLUMN decision_nonce;
ALTER TABLE payment_requests DROP COLUMN receipt_purged_at;
ALTER TABLE payment_requests DROP COLUMN receipt_expires_at;
ALTER TABLE payment_requests DROP COLUMN max_chars;
ALTER TABLE payment_requests DROP COLUMN max_requests;
ALTER TABLE payment_requests DROP COLUMN days;

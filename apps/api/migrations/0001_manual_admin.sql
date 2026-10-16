-- Dialon: administración manual (solo local por ahora). Sin conversaciones, textos, audio ni tokens.
-- Rollback documentado en apps/api/rollback/0001_manual_admin.down.sql (fuera de esta carpeta: no se aplica solo).
-- Una sentencia por bloque terminado en ';' al final de línea; sin triggers.

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY CHECK (length(uid) BETWEEN 1 AND 128),
  email TEXT CHECK (email IS NULL OR length(email) <= 320),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  uid TEXT PRIMARY KEY REFERENCES users (uid),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'suspended', 'inactive')),
  plan TEXT CHECK (plan IS NULL OR plan IN ('weekly', 'biweekly', 'monthly', 'custom')),
  period_start INTEGER,
  expires_at INTEGER,
  max_requests INTEGER NOT NULL DEFAULT 0 CHECK (max_requests BETWEEN 0 AND 100000),
  max_chars INTEGER NOT NULL DEFAULT 0 CHECK (max_chars BETWEEN 0 AND 10000000),
  used_requests INTEGER NOT NULL DEFAULT 0 CHECK (used_requests >= 0),
  used_chars INTEGER NOT NULL DEFAULT 0 CHECK (used_chars >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY CHECK (key IN ('translation', 'payments')),
  value TEXT NOT NULL CHECK (length(value) <= 4096),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_status (
  provider TEXT PRIMARY KEY CHECK (provider IN ('sarin', 'deepseek')),
  last_success_at INTEGER,
  last_failure_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) <= 64),
  target_uid TEXT
);

-- Fase 2 (solicitudes de transferencia): la tabla existe, pero aún no hay rutas que la usen.
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES users (uid),
  plan TEXT NOT NULL CHECK (plan IN ('weekly', 'biweekly', 'monthly')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 64),
  proof_key TEXT,
  proof_mime TEXT CHECK (proof_mime IS NULL OR proof_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  proof_bytes INTEGER CHECK (proof_bytes IS NULL OR (proof_bytes > 0 AND proof_bytes <= 5242880)),
  proof_uploaded_at INTEGER,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  UNIQUE (uid, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_requests_by_status ON payment_requests (status, created_at);

-- Central immutable, append-only audit trail for operational/security events.
-- Do not store raw citizen ids, token hashes, OTPs, or other secrets/PII in
-- target_id or metadata.

-- == up ==
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id
  ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON audit_log (target_type, target_id);

-- Enforce append-only at the DB level (not just by convention): block any
-- UPDATE/DELETE so the central audit trail cannot be rewritten.
CREATE OR REPLACE FUNCTION audit_log_block_mutation()
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'audit_log is append-only; % is not allowed', TG_OP;
  END;
  $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- == down == (see the .ts migration's down(); commented so running this file
-- manually does not immediately drop what it just created)
-- DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
-- DROP FUNCTION IF EXISTS audit_log_block_mutation();
-- DROP INDEX IF EXISTS idx_audit_log_target;
-- DROP INDEX IF EXISTS idx_audit_log_created_at;
-- DROP INDEX IF EXISTS idx_audit_log_action;
-- DROP INDEX IF EXISTS idx_audit_log_actor_user_id;
-- DROP TABLE IF EXISTS audit_log;

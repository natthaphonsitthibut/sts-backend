-- Phase 1 of PII masking: immutable, append-only log of every sensitive-PII
-- reveal. Additive and reversible. Subject is stored as a keyed HMAC reference
-- (see common/utils/pii-ref.util.ts), never the raw national id.

-- up
CREATE TABLE IF NOT EXISTS pii_access_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('STAFF', 'GUEST')),
  subject_student_ref TEXT NOT NULL,
  subject_ref_key_version SMALLINT NOT NULL DEFAULT 1,
  field_group TEXT NOT NULL CHECK (field_group IN ('NATIONAL_ID', 'PASSPORT', 'ADDRESS')),
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  purpose_link_id TEXT,
  request_id TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pii_access_events_subject
  ON pii_access_events (subject_student_ref, created_at);
CREATE INDEX IF NOT EXISTS idx_pii_access_events_actor
  ON pii_access_events (actor_user_id, created_at);

-- Enforce append-only at the DB level (not just by convention): block any
-- UPDATE/DELETE so the access trail cannot be rewritten.
CREATE OR REPLACE FUNCTION pii_access_events_block_mutation()
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'pii_access_events is append-only; % is not allowed', TG_OP;
  END;
  $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pii_access_events_immutable ON pii_access_events;
CREATE TRIGGER trg_pii_access_events_immutable
  BEFORE UPDATE OR DELETE ON pii_access_events
  FOR EACH ROW EXECUTE FUNCTION pii_access_events_block_mutation();

-- == down == (see the .ts migration's down(); commented so running this file
-- manually does not immediately drop what it just created)
-- DROP TRIGGER IF EXISTS trg_pii_access_events_immutable ON pii_access_events;
-- DROP FUNCTION IF EXISTS pii_access_events_block_mutation();
-- DROP TABLE IF EXISTS pii_access_events;

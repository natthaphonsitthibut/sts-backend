DROP TRIGGER IF EXISTS trg_pii_access_events_immutable ON pii_access_events;

ALTER TABLE pii_access_events
  ADD COLUMN IF NOT EXISTS subject_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS subject_ref TEXT;

UPDATE pii_access_events
SET subject_type = 'STUDENT', subject_ref = subject_student_ref
WHERE subject_type IS NULL OR subject_ref IS NULL;

ALTER TABLE pii_access_events
  ALTER COLUMN subject_type SET NOT NULL,
  ALTER COLUMN subject_ref SET NOT NULL;

ALTER TABLE pii_access_events
  ADD CONSTRAINT chk_pii_access_events_subject_type
  CHECK (subject_type IN ('STUDENT', 'USER')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_pii_access_events_typed_subject
  ON pii_access_events (subject_type, subject_ref, created_at);

CREATE TRIGGER trg_pii_access_events_immutable
  BEFORE UPDATE OR DELETE ON pii_access_events
  FOR EACH ROW EXECUTE FUNCTION pii_access_events_block_mutation();

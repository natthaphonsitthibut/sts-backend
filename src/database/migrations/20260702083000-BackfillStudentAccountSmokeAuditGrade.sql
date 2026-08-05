-- Backfill legacy student-account smoke audit rows that were generated with
-- room=1 but no grade before the API required grade+room together.

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;

UPDATE audit_log
SET metadata = jsonb_set(
  jsonb_set(
    metadata,
    '{grade}',
    to_jsonb('ม.6'::text),
    true
  ),
  '{gradeBackfillSource}',
  to_jsonb('student_accounts_smoke_grade_20260702'::text),
  true
)
WHERE action IN ('STUDENT_ACCOUNT_BULK_GENERATE', 'STUDENT_ACCOUNT_BATCH_ENQUEUE')
  AND actor_label = 'student_accounts_smoke_admin'
  AND metadata ->> 'schoolId' = '10010002'
  AND metadata ->> 'room' = '1'
  AND metadata ->> 'createdCount' = '1'
  AND NULLIF(metadata ->> 'grade', '') IS NULL;

CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- Down:
-- DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
-- UPDATE audit_log
-- SET metadata = metadata - 'grade' - 'gradeBackfillSource'
-- WHERE metadata ->> 'gradeBackfillSource' = 'student_accounts_smoke_grade_20260702';
-- CREATE TRIGGER trg_audit_log_immutable
--   BEFORE UPDATE OR DELETE ON audit_log
--   FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

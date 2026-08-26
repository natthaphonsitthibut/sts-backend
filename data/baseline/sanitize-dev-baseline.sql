\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() !~ '^sts_[a-z0-9_]*baseline$' THEN
    RAISE EXCEPTION 'Refusing to sanitize non-baseline database: %', current_database();
  END IF;
END
$guard$;

-- Runtime-only records and artifacts are not part of the development baseline.
-- One statement, because PostgreSQL refuses to truncate a table that any other
-- table references by foreign key unless both are truncated together - even when
-- the referencing table is already empty. Every referencing table is listed here.
TRUNCATE TABLE
  notifications,
  data_export_job_event,
  data_export_job,
  pii_export_request_students,
  pii_export_events,
  pii_export_requests,
  pii_access_events,
  student_import_quarantine_rows,
  student_import_batches,
  attendance_import_files,
  teacher_line_invitations,
  teacher_line_group_invitations,
  teacher_messaging_accounts,
  araid_profiles,
  araid_identity_records,
  audit_log;

-- Keep task/submission history while making every bearer credential unusable.
-- The OTP columns were dropped with the task-link OTP flow; identity is proven
-- through Google/AraID now, so only the bearer token and contacts need revoking.
UPDATE task_links
SET token_hash = encode(digest('sts-dev-baseline-task-link:' || id::text, 'sha256'), 'hex'),
    magic_link = NULL,
    token_encrypted = NULL,
    assigned_to_phone = NULL,
    assigned_to_email = NULL,
    status = 'EXPIRED',
    expires_at = TIMESTAMPTZ '2000-01-01 00:00:00+00';

UPDATE classroom_attendance_links
SET token_hash = encode(digest('sts-dev-baseline-classroom-link:' || id::text, 'sha256'), 'hex'),
    token_encrypted = 'baseline-revoked:' || id::text,
    link_status = 'INACTIVE',
    last_used_at = NULL,
    line_delivery_teacher_membership_id = NULL,
    line_delivery_status = 'NOT_READY',
    line_delivery_failure_code = NULL,
    line_delivery_attempt_count = 0,
    line_delivery_request_id = NULL,
    line_delivery_last_attempted_at = NULL,
    line_delivered_at = NULL;

-- Preserve presentation actors, but never copy a working password or provider contact.
UPDATE users
SET password = '!STS_BASELINE_LOGIN_DISABLED!',
    phone = NULL,
    email = NULL,
    line_id = NULL,
    temporary_password_issued_at = NULL,
    temporary_password_expires_at = NULL,
    photo_storage_key = NULL,
    must_change_password = TRUE;

UPDATE users
SET status = 'DISABLED',
    permissions = '[]'::jsonb,
    data_scope = '{"own_only":true}'::jsonb
WHERE data_origin_code = 'AUTOMATED_TEST';

-- Storage objects belong to the deployment that created them, not to a portable dump.
UPDATE teachers SET photo_storage_key = NULL WHERE photo_storage_key IS NOT NULL;
UPDATE student_person SET photo_storage_key = NULL WHERE photo_storage_key IS NOT NULL;
UPDATE school_classrooms SET cover_image_storage_key = NULL WHERE cover_image_storage_key IS NOT NULL;

-- Historical rollback tables keep their schema for migration history, but not duplicate data.
DO $truncate_backups$
DECLARE
  targets text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
  INTO targets
  FROM pg_tables
  WHERE schemaname = 'public'
    AND (tablename LIKE '%\_backup' ESCAPE '\' OR tablename LIKE '%\_backups' ESCAPE '\');

  IF targets IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || targets;
  END IF;
END
$truncate_backups$;

COMMIT;

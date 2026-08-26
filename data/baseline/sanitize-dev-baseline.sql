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

-- ---------------------------------------------------------------------------
-- Synthetic identity provenance.
--
-- Presentation rows carry national-id-, name- and address-shaped values. Being
-- generated is not the same as being provably generated, and this dump is
-- committed to the repository, so identity is regenerated here from each row's
-- surrogate key and re-derived by verify-dev-baseline.sql before any export.
--
-- These two helpers must stay identical to the copies in
-- verify-dev-baseline.sql: the verifier recomputes every value with them, so a
-- drift between the files fails verification instead of passing silently.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.baseline_synthetic_national_id(namespace text, seed text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $generate$
  WITH body AS (
    SELECT lpad(
      (
        (('x' || substr(md5(namespace || ':' || seed), 1, 15))::bit(60)::bigint
          % 900000000000) + 100000000000
      )::text,
      12,
      '0'
    ) AS digits
  ),
  weighted AS (
    SELECT
      body.digits,
      (
        SELECT sum(substr(body.digits, digit_index, 1)::int * (14 - digit_index))
        FROM generate_series(1, 12) AS digit_index
      ) AS total
    FROM body
  )
  -- The Thai national-id check digit is (11 - weighted % 11) % 10. Storing the
  -- next digit instead keeps the shape while guaranteeing the value can never
  -- be an issued citizen id.
  SELECT weighted.digits || ((((11 - weighted.total % 11) % 10) + 1) % 10)::text
  FROM weighted;
$generate$;

CREATE FUNCTION pg_temp.baseline_national_id(original text, namespace text, seed text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $apply$
DECLARE
  generated text;
BEGIN
  IF original IS NULL THEN
    RETURN NULL;
  END IF;
  -- Values that are not national-id shaped (passport numbers, short legacy
  -- keys) are left alone; anything carrying 13 digits is replaced.
  IF length(regexp_replace(original, '[^0-9]', '', 'g')) <> 13 THEN
    RETURN original;
  END IF;
  generated := pg_temp.baseline_synthetic_national_id(namespace, seed);
  IF original ~ '^[0-9]{13}$' THEN
    RETURN generated;
  END IF;
  IF original ~ '^[0-9]-[0-9]{4}-[0-9]{5}-[0-9]{2}-[0-9]$' THEN
    RETURN format(
      '%s-%s-%s-%s-%s',
      substr(generated, 1, 1),
      substr(generated, 2, 4),
      substr(generated, 6, 5),
      substr(generated, 11, 2),
      substr(generated, 13, 1)
    );
  END IF;
  -- Fail closed rather than export a layout nothing has proven synthetic.
  RAISE EXCEPTION 'Unrecognised national-id layout of length % in baseline', length(original);
END;
$apply$;

-- One identity per person: student_term and the canonical identifier row must
-- keep matching, so both derive from the same person key.
UPDATE student_term
SET "PersonID_Onec" = pg_temp.baseline_national_id(
  "PersonID_Onec", 'person', person_uuid::text
)
WHERE person_uuid IS NOT NULL;

UPDATE student_person_identifier
SET identifier_value = pg_temp.baseline_national_id(
      identifier_value, 'person', person_uuid::text
    ),
    identifier_normalized = regexp_replace(
      pg_temp.baseline_national_id(identifier_normalized, 'person', person_uuid::text),
      '[^0-9]', '', 'g'
    );

UPDATE users
SET "PersonID_Onec" = pg_temp.baseline_national_id("PersonID_Onec", 'user', id::text);

UPDATE teachers
SET citizen_id = pg_temp.baseline_national_id(citizen_id, 'teacher', id::text);

UPDATE external_users
SET "PersonID_Onec" = pg_temp.baseline_national_id(
  "PersonID_Onec", 'external_user', "ExternalID"::text
);

-- Household-precision address data: the house number is regenerated from the
-- enrollment key with the same rule the showcase migration uses, and home
-- coordinates are dropped entirely because nothing in a portable dump needs to
-- point at a dwelling.
UPDATE student_term
SET address_house_no =
      (1 + (('x' || substr(md5(student_uuid::text), 1, 8))::bit(32)::bigint % 199))::text
      || '/'
      || (1 + ((('x' || substr(md5(student_uuid::text), 1, 8))::bit(32)::bigint / 199) % 19))::text
WHERE address_house_no IS NOT NULL;

UPDATE student_term
SET address_latitude = NULL,
    address_longitude = NULL
WHERE address_latitude IS NOT NULL OR address_longitude IS NOT NULL;

UPDATE cases
SET student_lat = NULL,
    student_lng = NULL
WHERE student_lat IS NOT NULL OR student_lng IS NOT NULL;

TRUNCATE TABLE student_home_geocode_cache;

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

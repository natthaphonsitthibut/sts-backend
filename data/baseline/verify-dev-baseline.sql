\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Synthetic identity provenance.
--
-- These two helpers must stay byte-identical to the copies in
-- sanitize-dev-baseline.sql. The assertions below recompute every identity
-- value with them, so a drift between the files fails here instead of shipping
-- an unproven dump.
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
  RAISE EXCEPTION 'Unrecognised national-id layout of length % in baseline', length(original);
END;
$apply$;

/** True when a value carries an issued Thai national-id check digit. */
CREATE FUNCTION pg_temp.baseline_is_real_national_id(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $real$
  WITH digits AS (SELECT regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') AS body)
  SELECT
    length(digits.body) = 13
    AND (
      (
        11 - (
          SELECT sum(substr(digits.body, digit_index, 1)::int * (14 - digit_index))
          FROM generate_series(1, 12) AS digit_index
        ) % 11
      ) % 10
    ) = substr(digits.body, 13, 1)::int
  FROM digits;
$real$;

DO $identity$
DECLARE
  issue_count bigint;
  ratio numeric;
BEGIN
  -- Every national-id-shaped value must be reproducible from the row's own
  -- surrogate key. A value copied from anywhere else cannot survive this.
  SELECT
    (SELECT count(*) FROM student_term
      WHERE "PersonID_Onec" IS DISTINCT FROM
        pg_temp.baseline_national_id("PersonID_Onec", 'person', person_uuid::text))
    + (SELECT count(*) FROM student_person_identifier
        WHERE identifier_value IS DISTINCT FROM
          pg_temp.baseline_national_id(identifier_value, 'person', person_uuid::text)
          OR identifier_normalized IS DISTINCT FROM regexp_replace(
            pg_temp.baseline_national_id(identifier_normalized, 'person', person_uuid::text),
            '[^0-9]', '', 'g'))
    + (SELECT count(*) FROM users
        WHERE "PersonID_Onec" IS DISTINCT FROM
          pg_temp.baseline_national_id("PersonID_Onec", 'user', id::text))
    + (SELECT count(*) FROM teachers
        WHERE citizen_id IS DISTINCT FROM
          pg_temp.baseline_national_id(citizen_id, 'teacher', id::text))
    + (SELECT count(*) FROM external_users
        WHERE "PersonID_Onec" IS DISTINCT FROM
          pg_temp.baseline_national_id("PersonID_Onec", 'external_user', "ExternalID"::text))
  INTO issue_count;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Identity values that are not reproducibly synthetic: %', issue_count;
  END IF;

  -- The same enrollment must not disagree with its canonical identifier row.
  SELECT count(*) INTO issue_count
  FROM student_term enrollment
  JOIN student_person_identifier identifier
    ON identifier.person_uuid = enrollment.person_uuid
  WHERE regexp_replace(enrollment."PersonID_Onec", '[^0-9]', '', 'g')
    <> identifier.identifier_normalized;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Enrollment and canonical identifier disagree: % rows', issue_count;
  END IF;

  -- Belt and braces on the same data: nothing shaped like a national id may
  -- carry a valid check digit, so no value can be an issued citizen id.
  SELECT
    (SELECT count(*) FROM student_term
      WHERE pg_temp.baseline_is_real_national_id("PersonID_Onec"))
    + (SELECT count(*) FROM student_person_identifier
        WHERE pg_temp.baseline_is_real_national_id(identifier_value)
           OR pg_temp.baseline_is_real_national_id(identifier_normalized))
    + (SELECT count(*) FROM users
        WHERE pg_temp.baseline_is_real_national_id("PersonID_Onec"))
    + (SELECT count(*) FROM teachers
        WHERE pg_temp.baseline_is_real_national_id(citizen_id))
    + (SELECT count(*) FROM external_users
        WHERE pg_temp.baseline_is_real_national_id("PersonID_Onec"))
  INTO issue_count;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Values carrying a valid national-id check digit remain: %', issue_count;
  END IF;

  -- A longer digit run would slip past the 13-digit rewrite rule entirely.
  SELECT
    (SELECT count(*) FROM student_term
      WHERE length(regexp_replace("PersonID_Onec", '[^0-9]', '', 'g')) > 13)
    + (SELECT count(*) FROM users
        WHERE length(regexp_replace("PersonID_Onec", '[^0-9]', '', 'g')) > 13)
    + (SELECT count(*) FROM teachers
        WHERE length(regexp_replace(citizen_id, '[^0-9]', '', 'g')) > 13)
  INTO issue_count;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Identity columns hold longer digit runs than the mask covers: %', issue_count;
  END IF;

  -- Person names are drawn from a small generated pool. A real roster has
  -- near-unique surnames, so the ratio separates the two without pinning an
  -- exact catalog the presentation data is free to grow.
  SELECT max(distinct_ratio) INTO ratio
  FROM (
    SELECT count(DISTINCT "FirstName_Onec")::numeric / nullif(count(*), 0) FROM student_term
    UNION ALL
    SELECT count(DISTINCT "LastName_Onec")::numeric / nullif(count(*), 0) FROM student_term
    UNION ALL
    SELECT count(DISTINCT first_name)::numeric / nullif(count(*), 0) FROM teachers
    UNION ALL
    SELECT count(DISTINCT last_name)::numeric / nullif(count(*), 0) FROM teachers
  ) AS pools(distinct_ratio);
  IF ratio > 0.25 THEN
    RAISE EXCEPTION 'Person names are not pool-drawn (highest distinct ratio %)', ratio;
  END IF;

  -- Locality text is catalog-driven for the same reason.
  SELECT max(distinct_ratio) INTO ratio
  FROM (
    SELECT count(DISTINCT "Street_Onec")::numeric / nullif(count("Street_Onec"), 0) FROM student_term
    UNION ALL
    SELECT count(DISTINCT "Soi_Onec")::numeric / nullif(count("Soi_Onec"), 0) FROM student_term
    UNION ALL
    SELECT count(DISTINCT "Trok_Onec")::numeric / nullif(count("Trok_Onec"), 0) FROM student_term
    UNION ALL
    SELECT count(DISTINCT "VillageNumber_Onec")::numeric
      / nullif(count("VillageNumber_Onec"), 0) FROM student_term
    UNION ALL
    SELECT count(DISTINCT "PostalCode_Onec")::numeric
      / nullif(count("PostalCode_Onec"), 0) FROM student_term
  ) AS pools(distinct_ratio);
  IF ratio > 0.25 THEN
    RAISE EXCEPTION 'Address locality text is not catalog-drawn (highest distinct ratio %)', ratio;
  END IF;

  -- House numbers are the household-precision part of an address, so they must
  -- be reproducible from the enrollment key rather than merely plausible.
  SELECT count(*) INTO issue_count
  FROM student_term
  WHERE address_house_no IS NOT NULL
    AND address_house_no <>
      (1 + (('x' || substr(md5(student_uuid::text), 1, 8))::bit(32)::bigint % 199))::text
      || '/'
      || (1 + ((('x' || substr(md5(student_uuid::text), 1, 8))::bit(32)::bigint / 199) % 19))::text;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'House numbers that are not reproducibly synthetic: %', issue_count;
  END IF;

  -- Nothing portable needs coordinates that point at a dwelling.
  SELECT
    (SELECT count(*) FROM student_term
      WHERE address_latitude IS NOT NULL OR address_longitude IS NOT NULL)
    + (SELECT count(*) FROM cases WHERE student_lat IS NOT NULL OR student_lng IS NOT NULL)
    + (SELECT count(*) FROM student_home_geocode_cache)
  INTO issue_count;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Home coordinates remain in the baseline: %', issue_count;
  END IF;
END
$identity$;

DO $verify$
DECLARE
  issue_count integer;
  backup_row_count bigint;
BEGIN
  IF current_setting('server_version_num')::integer < 150000
     OR current_setting('server_version_num')::integer >= 160000 THEN
    RAISE EXCEPTION 'Canonical baseline requires PostgreSQL 15, got %', version();
  END IF;

  SELECT count(*) INTO issue_count
  FROM (VALUES
    ((SELECT count(*) FROM schools), 10::bigint, 'schools'),
    ((SELECT count(*) FROM school_terms), 10::bigint, 'school_terms'),
    ((SELECT count(*) FROM school_classrooms WHERE deleted_at IS NULL), 441::bigint, 'school_classrooms'),
    ((SELECT count(*) FROM teachers WHERE deleted_at IS NULL), 451::bigint, 'teachers'),
    ((SELECT count(*) FROM school_teacher_memberships WHERE membership_status = 'ACTIVE' AND deleted_at IS NULL), 451::bigint, 'active memberships'),
    ((SELECT count(*) FROM student_term WHERE deleted_at IS NULL), 6000::bigint, 'student_term'),
    ((SELECT count(*) FROM migrations), 258::bigint, 'migrations')
  ) AS checks(actual, expected, label)
  WHERE actual <> expected;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Business-data or migration manifest mismatch (% checks)', issue_count;
  END IF;

  SELECT count(*) INTO issue_count
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relkind IN ('r', 'p', 'v', 'm')
    AND relname IN (
      'attendance', 'classroom_teacher_assignments', 'curriculum_subject_teachers',
      'curriculum_subjects', 'school_period_times', 'teacher_access_grants',
      'teacher_access_grant_assignments', 'teacher_access_grant_capabilities',
      'timetable_slots', 'timetable_slot_teachers'
    );
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Legacy relations remain in canonical baseline: %', issue_count;
  END IF;

  SELECT
    (SELECT count(*) FROM notifications)
    + (SELECT count(*) FROM data_export_job)
    + (SELECT count(*) FROM data_export_job_event)
    + (SELECT count(*) FROM pii_access_events)
    + (SELECT count(*) FROM pii_export_requests)
    + (SELECT count(*) FROM student_import_batches)
    + (SELECT count(*) FROM student_import_quarantine_rows)
    + (SELECT count(*) FROM attendance_import_files)
    + (SELECT count(*) FROM teacher_line_invitations)
    + (SELECT count(*) FROM teacher_line_group_invitations)
    + (SELECT count(*) FROM teacher_messaging_accounts)
    + (SELECT count(*) FROM araid_identity_records)
    + (SELECT count(*) FROM araid_profiles)
    + (SELECT count(*) FROM audit_log)
  INTO issue_count;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Runtime/session/provider artifact rows remain: %', issue_count;
  END IF;

  -- The task-link OTP columns are gone; the bearer token and the contacts it was
  -- delivered to are the only credentials left to prove revoked.
  SELECT count(*) INTO issue_count
  FROM task_links
  WHERE status <> 'EXPIRED'
     OR magic_link IS NOT NULL
     OR token_encrypted IS NOT NULL
     OR assigned_to_phone IS NOT NULL
     OR assigned_to_email IS NOT NULL;
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Active task-link credentials remain: %', issue_count;
  END IF;

  SELECT count(*) INTO issue_count
  FROM classroom_attendance_links
  WHERE link_status <> 'INACTIVE'
     OR token_encrypted NOT LIKE 'baseline-revoked:%'
     OR line_delivery_status <> 'NOT_READY';
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Active classroom-link/provider credentials remain: %', issue_count;
  END IF;

  SELECT count(*) INTO issue_count
  FROM users
  WHERE password <> '!STS_BASELINE_LOGIN_DISABLED!'
     OR phone IS NOT NULL
     OR email IS NOT NULL
     OR line_id IS NOT NULL
     OR photo_storage_key IS NOT NULL
     OR temporary_password_issued_at IS NOT NULL
     OR temporary_password_expires_at IS NOT NULL
     OR (data_origin_code = 'AUTOMATED_TEST' AND status <> 'DISABLED');
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Copied user credentials/provider contacts remain: %', issue_count;
  END IF;

  SELECT coalesce(sum((xpath('/row/count/text()', xml_count))[1]::text::bigint), 0)
  INTO backup_row_count
  FROM (
    SELECT query_to_xml(
      format('SELECT count(*) AS count FROM %I.%I', schemaname, tablename),
      false,
      true,
      ''
    ) AS xml_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND (tablename LIKE '%\_backup' ESCAPE '\' OR tablename LIKE '%\_backups' ESCAPE '\')
  ) backups;
  IF backup_row_count <> 0 THEN
    RAISE EXCEPTION 'Rollback backup tables still contain duplicate data: % rows', backup_row_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM migrations WHERE name = 'DropLegacyAttendanceContracts20260827310000'
  ) THEN
    RAISE EXCEPTION 'Legacy attendance cutover migration is missing';
  END IF;

  -- The cutover destroys the legacy per-mark table, so a baseline that lost
  -- recorder provenance can never satisfy the provenance guard again. Fail here,
  -- while the dump can still be rebuilt, instead of in every fresh environment.
  IF NOT EXISTS (
    SELECT 1 FROM migrations WHERE name = 'RemoveUnverifiableAttendanceHistory20260827313200'
  ) THEN
    RAISE EXCEPTION 'Attendance provenance guard has not been applied to this baseline';
  END IF;

  SELECT count(*) INTO issue_count
  FROM attendance_sessions session
  WHERE session.record_storage_mode = 'EXCEPTIONS'
    AND session.status IN ('SUBMITTED', 'REOPENED')
    AND session.deleted_at IS NULL
    AND session.submitted_by IS NULL
    AND session.started_by_teacher_membership_id IS NULL
    AND session.submitted_by_teacher_membership_id IS NULL
    AND EXISTS (
      SELECT 1 FROM attendance_session_roster roster
      WHERE roster.session_id = session.id AND roster.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM attendance_exceptions exception
      WHERE exception.session_id = session.id
        AND exception.marked_by_teacher_membership_id IS NOT NULL
        AND exception.deleted_at IS NULL
    );
  IF issue_count <> 0 THEN
    RAISE EXCEPTION 'Attendance sessions without a verifiable recorder: %', issue_count;
  END IF;
END
$verify$;

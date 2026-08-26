\set ON_ERROR_STOP on

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
    ((SELECT count(*) FROM migrations), 256::bigint, 'migrations')
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

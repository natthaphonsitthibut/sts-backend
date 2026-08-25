require('dotenv/config');

const appDataSource = require('../dist/database/typeorm.datasource').default;

const STRICT = process.argv.includes('--strict');
const ALLOW_AUTOMATED_TEST = process.argv.includes('--allow-automated-test');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await appDataSource.initialize();
  try {
    const [audit] = await appDataSource.query(`
      SELECT
        (SELECT CASE WHEN
          (SELECT COUNT(*) FROM teachers WHERE deleted_at IS NULL) = 451
          AND (SELECT COUNT(*) FROM teachers
               WHERE deleted_at IS NULL AND teacher_status = 'ACTIVE') = 451
          AND (SELECT COUNT(*) FROM school_teacher_memberships WHERE deleted_at IS NULL) = 451
          AND (SELECT COUNT(*) FROM school_teacher_memberships
               WHERE deleted_at IS NULL
                 AND membership_status = 'ACTIVE'
                 AND ended_on IS NULL) = 451
          THEN 0 ELSE 1 END
        ) AS presentation_teacher_baseline_issues,
        (SELECT COUNT(*)::int
         FROM data_record_origins
         WHERE code = 'DEMO'
           AND (
             label_th <> 'ข้อมูลสำหรับการนำเสนอ'
             OR is_visible_by_default
             OR label_th ~* '(demo|smoke|test|sample|fake|ข้อมูลสาธิต|ข้อมูลทดสอบ)'
           )
        ) AS presentation_origin_catalog_issues,
        (SELECT CASE WHEN
          COUNT(*) = 4
          AND COUNT(*) FILTER (
            WHERE is_active = TRUE
              AND contact_phone IS NULL
              AND contact_email IS NULL
              AND website_url IS NULL
              AND agency_kind_code = CASE agency_name
                WHEN 'กรมส่งเสริมการเรียนรู้' THEN 'LEARNING_PROMOTION'
                WHEN 'สถาบันสุขภาพเด็กแห่งชาติมหาราชินี' THEN 'PUBLIC_HOSPITAL'
                WHEN 'มูลนิธิศูนย์พิทักษ์สิทธิเด็ก' THEN 'CHILD_FOUNDATION'
                WHEN 'กรมกิจการเด็กและเยาวชน' THEN 'OTHER'
              END
          ) = 4
          THEN 0 ELSE 1 END
         FROM referral_agencies
         WHERE agency_name IN (
           'กรมส่งเสริมการเรียนรู้',
           'สถาบันสุขภาพเด็กแห่งชาติมหาราชินี',
           'มูลนิธิศูนย์พิทักษ์สิทธิเด็ก',
           'กรมกิจการเด็กและเยาวชน'
         )
        ) AS referral_directory_issues,
        ((SELECT COUNT(*)::int FROM users
          WHERE lower(split_part(email, '@', 2)) = 'sts-demo.ac.th')
         + (SELECT COUNT(*)::int FROM teachers
            WHERE lower(split_part(email, '@', 2)) = 'sts-demo.ac.th')
         + (SELECT COUNT(*)::int FROM task_links
            WHERE lower(split_part(assigned_to_email, '@', 2)) = 'sts-demo.ac.th')
         + (SELECT COUNT(*)::int FROM teacher_external_identities
            WHERE lower(split_part(normalized_email, '@', 2)) = 'sts-demo.ac.th')
         + (SELECT COUNT(*)::int FROM araid_identity_records
            WHERE lower(split_part(email_address, '@', 2)) = 'sts-demo.ac.th')
         + (SELECT COUNT(*)::int FROM student_guardian
            WHERE lower(split_part(email, '@', 2)) = 'sts-demo.ac.th')
         + (SELECT COUNT(*)::int FROM student_person_contact
            WHERE lower(split_part(email, '@', 2)) = 'sts-demo.ac.th')
        ) AS legacy_presentation_email_rows,
        (SELECT COUNT(*)::int
         FROM student_term
         WHERE deleted_at IS NULL
           AND concat_ws(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
             ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
        ) AS placeholder_student_rows,
        (SELECT CASE WHEN
          (SELECT COUNT(*) FROM attendance_sessions WHERE deleted_at IS NULL) > 0
          AND (SELECT COUNT(*) FROM attendance_effective_records) > 0
          AND (SELECT COUNT(*) FROM attendance_exceptions WHERE deleted_at IS NULL) > 0
          AND (SELECT COUNT(*) FROM student_risk_profiles) > 0
          AND (SELECT COUNT(*) FROM cases WHERE deleted_at IS NULL) > 0
          THEN 0 ELSE 1 END
        ) AS empty_presentation_dashboard_issues,
        ((SELECT COUNT(*)::int FROM schools
          WHERE concat_ws(' ', name, province, district, sub_district)
            ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM subjects
            WHERE concat_ws(' ', code, name_th)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM school_classrooms
            WHERE concat_ws(' ', room_code, room_name)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM teachers
            WHERE concat_ws(' ', first_name, last_name, email)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM users
            WHERE data_origin_code <> 'AUTOMATED_TEST'
              AND concat_ws(
                ' ', username, affiliation, "FirstName", "LastName", email, deactivation_note
              ) ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM student_term
            WHERE deleted_at IS NULL
              AND concat_ws(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
                ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM task_links
            WHERE deleted_at IS NULL
              AND concat_ws(
                ' ', assigned_to_name, assigned_to_first_name, assigned_to_last_name,
                assigned_to_email, subject, assignment_note, cancel_reason
              ) ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)')
         + (SELECT COUNT(*)::int FROM school_calendar_days
            WHERE coalesce(reason, '')
              ~* '(demo|smoke|test|sample|fake|ข้อมูลสาธิต|ข้อมูลทดสอบ)')
        ) AS forbidden_business_surface_rows,
        (SELECT COUNT(*)::int
         FROM users
         WHERE data_origin_code = 'AUTOMATED_TEST' AND status = 'ACTIVE'
        ) AS active_automated_users,
        (SELECT COUNT(*)::int
         FROM users
         WHERE lower(split_part(email, '@', 2)) = 'school.sts.local'
           AND data_origin_code <> 'DEMO'
        ) AS mislabeled_demo_users,
        (SELECT COUNT(*)::int
         FROM users
         WHERE data_origin_code <> 'AUTOMATED_TEST'
           AND (
             username ~* '(seed|demo|smoke|test|sample|fake|fixture)'
             OR COALESCE("PersonID_Onec", '') ~* '(seed|demo|smoke|test|sample|fake|fixture)'
             OR COALESCE(email, '')
               ~* '(example\\\\.|seed|demo|smoke|test|sample|fake|fixture)'
           )
        ) AS runtime_user_fixture_markers,
        (SELECT COUNT(*)::int
         FROM users
         WHERE data_origin_code = 'DEMO'
           AND role = 'TEACHER'
           AND (
             email IS NULL
             OR lower(email) <> lower(username || '@school.sts.local')
           )
        ) AS demo_teacher_email_issues,
        (SELECT COUNT(*)::int
         FROM cases case_record
         JOIN users actor ON actor.id = case_record.created_by
         WHERE actor.data_origin_code = 'AUTOMATED_TEST'
           AND case_record.deleted_at IS NULL
        ) AS active_automated_cases,
        (SELECT COUNT(*)::int
         FROM tasks task
         JOIN users actor ON actor.id = task.created_by
         WHERE actor.data_origin_code = 'AUTOMATED_TEST'
           AND task.deleted_at IS NULL
        ) AS active_automated_tasks,
        (SELECT COUNT(*)::int
         FROM attendance_effective_records record
         LEFT JOIN attendance_sessions session ON session.id = record.session_id
         LEFT JOIN users actor ON actor.id = session.submitted_by
         WHERE record."RecordedBy" ~* '(seed|smoke|test|fixture)'
           AND COALESCE(actor.data_origin_code, '') <> 'AUTOMATED_TEST'
        ) AS attendance_fixture_recorders,
        (SELECT COUNT(*)::int
         FROM attendance_exceptions record
         JOIN attendance_sessions session ON session.id = record.session_id
         JOIN users actor ON actor.id = session.submitted_by
         WHERE actor.data_origin_code = 'DEMO'
           AND (
             (record.created_by IS NOT NULL
               AND record.created_by IS DISTINCT FROM session.submitted_by)
             OR (record.updated_by IS NOT NULL
               AND record.updated_by IS DISTINCT FROM session.submitted_by)
           )
        ) AS demo_attendance_actor_issues,
        (SELECT COUNT(*)::int
         FROM task_links link
         LEFT JOIN users actor ON actor.id = link.created_by
         WHERE COALESCE(link.assigned_to_email, '')
           ~* '(example\\\\.|seed|demo|smoke|test|sample|fake|fixture)'
           AND COALESCE(actor.data_origin_code, '') <> 'AUTOMATED_TEST'
        ) AS task_link_fixture_emails,
        (SELECT COUNT(*)::int
         FROM tasks task
         WHERE EXISTS (
           SELECT 1
           FROM task_links link
           WHERE link.task_id = task.id
             AND lower(split_part(link.assigned_to_email, '@', 2)) = 'school.sts.local'
         )
           AND NOT EXISTS (
             SELECT 1
             FROM users actor
             WHERE actor.id = task.created_by
               AND actor.data_origin_code = 'DEMO'
           )
        ) AS demo_task_actor_issues,
        (SELECT COUNT(*)::int
         FROM task_links link
         WHERE lower(split_part(link.assigned_to_email, '@', 2)) = 'school.sts.local'
           AND NOT EXISTS (
             SELECT 1
             FROM users actor
             WHERE actor.id = link.created_by
               AND actor.data_origin_code = 'DEMO'
           )
        ) AS demo_task_link_actor_issues,
        (SELECT COUNT(*)::int
         FROM task_submissions submission
         JOIN task_links link ON link.id = submission.task_link_id
         LEFT JOIN users link_actor ON link_actor.id = link.created_by
         WHERE lower(split_part(link.assigned_to_email, '@', 2)) = 'school.sts.local'
           AND (
             link.assigned_teacher_id IS NULL
             OR COALESCE(link_actor.data_origin_code, '') <> 'DEMO'
             -- The magic-link token is the guest credential; the submission
             -- repository intentionally leaves user audit actors NULL.
             OR submission.created_by IS NOT NULL
             OR submission.updated_by IS NOT NULL
           )
        ) AS presentation_guest_submission_issues,
        (SELECT COUNT(*)::int
         FROM case_reviews
         WHERE reviewed_by ILIKE 'system:%'
        ) AS system_rows_in_human_reviews,
        (SELECT COUNT(*)::int
         FROM case_reviews review
         WHERE review.source_actor_user_id IS NULL
           AND 1 = (
             SELECT COUNT(DISTINCT actor.id)
             FROM users actor
             WHERE actor.username = review.reviewed_by
                OR trim(concat_ws(' ', actor."FirstName", actor."LastName")) =
                   trim(review.reviewed_by)
           )
        ) AS uniquely_matchable_reviews_without_actor
    `);

    const report = {
      status: 'presentation_data_audit',
      ...audit,
    };
    console.log(JSON.stringify(report));

    if (STRICT) {
      const allowedAutomatedFields = new Set([
        'active_automated_users',
        'active_automated_cases',
        'active_automated_tasks',
      ]);
      const failures = Object.entries(audit).filter(
        ([field, value]) =>
          Number(value) !== 0 && !(ALLOW_AUTOMATED_TEST && allowedAutomatedFields.has(field)),
      );
      assert(
        failures.length === 0,
        `Presentation data audit failed: ${failures
          .map(([field, value]) => `${field}=${value}`)
          .join(', ')}`,
      );
    }
  } finally {
    await appDataSource.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Presentation data audit failed');
    process.exit(1);
  });

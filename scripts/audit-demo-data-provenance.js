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
        (SELECT COUNT(*)::int
         FROM users
         WHERE data_origin_code = 'AUTOMATED_TEST' AND status = 'ACTIVE'
        ) AS active_automated_users,
        (SELECT COUNT(*)::int
         FROM users
         WHERE lower(split_part(email, '@', 2)) = 'sts-demo.ac.th'
           AND data_origin_code <> 'DEMO'
        ) AS mislabeled_demo_users,
        (SELECT COUNT(*)::int
         FROM users
         WHERE data_origin_code <> 'AUTOMATED_TEST'
           AND (
             username ~* '(seed|smoke|test|fixture)'
             OR COALESCE("PersonID_Onec", '') ~* '(seed|smoke|test|fixture)'
             OR COALESCE(email, '') ~* '(example\\\\.|seed|smoke|test|fixture)'
           )
        ) AS runtime_user_fixture_markers,
        (SELECT COUNT(*)::int
         FROM users
         WHERE data_origin_code = 'DEMO'
           AND role = 'TEACHER'
           AND (
             email IS NULL
             OR lower(email) <> lower(username || '@sts-demo.ac.th')
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
         FROM attendance record
         LEFT JOIN attendance_sessions session ON session.id = record.session_id
         LEFT JOIN users actor ON actor.id = COALESCE(record.created_by, session.submitted_by)
         WHERE record."RecordedBy" ~* '(seed|smoke|test|fixture)'
           AND COALESCE(actor.data_origin_code, '') <> 'AUTOMATED_TEST'
        ) AS attendance_fixture_recorders,
        (SELECT COUNT(*)::int
         FROM attendance record
         JOIN attendance_sessions session ON session.id = record.session_id
         JOIN users actor ON actor.id = session.submitted_by
         WHERE actor.data_origin_code = 'DEMO'
           AND (
             record.created_by IS DISTINCT FROM session.submitted_by
             OR record.updated_by IS DISTINCT FROM session.submitted_by
             OR record."RecordedBy" IS DISTINCT FROM actor.username
           )
        ) AS demo_attendance_actor_issues,
        (SELECT COUNT(*)::int
         FROM task_links link
         LEFT JOIN users actor ON actor.id = link.created_by
         WHERE COALESCE(link.assigned_to_email, '') ~* '(example\\\\.|seed|smoke|test|fixture)'
           AND COALESCE(actor.data_origin_code, '') <> 'AUTOMATED_TEST'
        ) AS task_link_fixture_emails,
        (SELECT COUNT(*)::int
         FROM tasks task
         WHERE EXISTS (
           SELECT 1
           FROM task_links link
           WHERE link.task_id = task.id
             AND lower(split_part(link.assigned_to_email, '@', 2)) = 'sts-demo.ac.th'
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
         WHERE lower(split_part(link.assigned_to_email, '@', 2)) = 'sts-demo.ac.th'
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
         WHERE lower(split_part(link.assigned_to_email, '@', 2)) = 'sts-demo.ac.th'
           AND NOT EXISTS (
             SELECT 1
             FROM users actor
             WHERE actor.id = submission.created_by
               AND actor.data_origin_code = 'DEMO'
           )
        ) AS demo_submission_actor_issues,
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
      status: 'demo_data_provenance_audit',
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
          Number(value) !== 0 &&
          !(ALLOW_AUTOMATED_TEST && allowedAutomatedFields.has(field)),
      );
      assert(
        failures.length === 0,
        `Demo data provenance audit failed: ${failures
          .map(([field, value]) => `${field}=${value}`)
          .join(', ')}`,
      );
    }
  } finally {
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Demo data provenance audit failed');
  process.exitCode = 1;
});

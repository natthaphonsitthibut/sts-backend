import 'reflect-metadata';
import appDataSource from '../database/typeorm.datasource';

/**
 * One-time catch-up for existing curriculum teacher coverage recorded before
 * `replaceTeacherCoverage` started syncing `classroom_teacher_assignments`.
 *
 * `curriculum_subject_teachers` is the curriculum page's own record of "who
 * teaches this subject" and nothing outside that page reads it; issuing an
 * attendance link reads `classroom_teacher_assignments` instead. A subject
 * teacher assigned before this fix therefore has a coverage row with no
 * matching assignment row, and link issuance refuses them as if they taught
 * nothing. This inserts the missing assignment for every such row — additive
 * only, safe to run more than once (`ON CONFLICT DO NOTHING` against the same
 * partial unique index the sync path uses).
 */
async function main(): Promise<void> {
  await appDataSource.initialize();
  try {
    const result = await appDataSource.query<Array<{ id: string }>>(`
      INSERT INTO classroom_teacher_assignments (
        school_id, classroom_id, teacher_membership_id, subject_id,
        assignment_kind, assignment_status
      )
      SELECT DISTINCT
        cst.school_id, cst.classroom_id, cst.teacher_membership_id, cs.subject_id,
        'SUBJECT', 'ACTIVE'
      FROM curriculum_subject_teachers cst
      JOIN curriculum_subjects cs ON cs.id = cst.curriculum_subject_id AND cs.deleted_at IS NULL
      WHERE cst.deleted_at IS NULL
      ON CONFLICT (classroom_id, teacher_membership_id, subject_id)
        WHERE assignment_kind = 'SUBJECT'
          AND assignment_status = 'ACTIVE'
          AND deleted_at IS NULL
      DO NOTHING
      RETURNING id
    `);
    console.log(`Backfilled ${result.length} subject-teacher attendance assignment(s).`);
  } finally {
    await appDataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

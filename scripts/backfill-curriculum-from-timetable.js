require('dotenv/config');

const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');

/**
 * Seeds จัดการข้อมูลหลักสูตร from the timetable the school already maintains.
 *
 * `timetable_slots` already says "this subject is taught in this classroom by
 * this teacher for this term", which is exactly what a curriculum offering plus
 * its teacher coverage records — so a school that has a timetable should not have
 * to retype its curriculum.
 *
 * Idempotent: both inserts rely on the partial unique indexes, so re-running adds
 * only what is missing and never touches rows an admin edited by hand. It is a
 * script rather than a migration precisely because `down()` could not tell
 * backfilled rows from hand-entered ones.
 */
async function main() {
  await appDataSource.initialize();
  const runner = appDataSource.createQueryRunner();
  await runner.connect();

  try {
    const [before] = await runner.query(`
      SELECT
        (SELECT COUNT(*)::int FROM curriculum_subjects WHERE deleted_at IS NULL) AS offerings,
        (SELECT COUNT(*)::int FROM curriculum_subject_teachers WHERE deleted_at IS NULL) AS coverage
    `);
    const [candidates] = await runner.query(`
      SELECT
        COUNT(DISTINCT (slot.school_term_id, slot.grade_level_id, slot.subject_id))::int AS offerings,
        COUNT(DISTINCT (slot.school_term_id, slot.grade_level_id, slot.subject_id,
                        slot.teacher_membership_id, slot.classroom_id))::int AS coverage
      FROM timetable_slots slot
      WHERE slot.deleted_at IS NULL
        AND slot.subject_id IS NOT NULL
        AND slot.teacher_membership_id IS NOT NULL
    `);

    console.log(`existing offerings/coverage : ${before.offerings} / ${before.coverage}`);
    console.log(`timetable candidates        : ${candidates.offerings} / ${candidates.coverage}`);

    if (AUDIT_ONLY) {
      console.log('audit-only: no changes written');
      return;
    }

    await runner.startTransaction();

    await runner.query(`
      INSERT INTO curriculum_subjects (school_id, school_term_id, grade_level_id, subject_id)
      SELECT DISTINCT slot.school_id, slot.school_term_id, slot.grade_level_id, slot.subject_id
      FROM timetable_slots slot
      WHERE slot.deleted_at IS NULL
        AND slot.subject_id IS NOT NULL
      ON CONFLICT (school_term_id, grade_level_id, subject_id)
        WHERE deleted_at IS NULL
        DO NOTHING
    `);

    // Coverage needs a resolved membership; slots whose teacher has no active
    // membership are reported below rather than silently dropped.
    await runner.query(`
      INSERT INTO curriculum_subject_teachers (
        curriculum_subject_id, school_id, school_term_id, grade_level_id,
        teacher_membership_id, classroom_id
      )
      SELECT DISTINCT
        offering.id,
        slot.school_id,
        slot.school_term_id,
        slot.grade_level_id,
        slot.teacher_membership_id,
        slot.classroom_id
      FROM timetable_slots slot
      JOIN curriculum_subjects offering
        ON offering.school_term_id = slot.school_term_id
       AND offering.grade_level_id = slot.grade_level_id
       AND offering.subject_id = slot.subject_id
       AND offering.deleted_at IS NULL
      WHERE slot.deleted_at IS NULL
        AND slot.subject_id IS NOT NULL
        AND slot.teacher_membership_id IS NOT NULL
      ON CONFLICT (curriculum_subject_id, teacher_membership_id, classroom_id)
        WHERE deleted_at IS NULL
        DO NOTHING
    `);

    await runner.commitTransaction();

    const [after] = await runner.query(`
      SELECT
        (SELECT COUNT(*)::int FROM curriculum_subjects WHERE deleted_at IS NULL) AS offerings,
        (SELECT COUNT(*)::int FROM curriculum_subject_teachers WHERE deleted_at IS NULL) AS coverage
    `);
    const [skipped] = await runner.query(`
      SELECT COUNT(*)::int AS slots
      FROM timetable_slots slot
      WHERE slot.deleted_at IS NULL
        AND slot.subject_id IS NOT NULL
        AND slot.teacher_membership_id IS NULL
    `);

    console.log(`offerings : ${before.offerings} -> ${after.offerings}`);
    console.log(`coverage  : ${before.coverage} -> ${after.coverage}`);
    if (skipped.slots > 0) {
      console.log(`skipped   : ${skipped.slots} timetable slot(s) without a teacher membership`);
    }
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

require('dotenv/config');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run the demo student-number seed with NODE_ENV=production');
}

const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');

/**
 * Fills `student_term.student_number` for demo enrollments that have none.
 *
 * Schools own this code in production — it arrives through the student import
 * and the app never rewrites one. That is exactly why every demo enrollment is
 * blank and every roster shows "-", so this seed hands the demo data the same
 * shape a real school would supply:
 *
 *   66 160001
 *   │  └── running number inside the school + term, ordered by ชั้น → ห้อง → ชื่อ
 *   └───── last two digits of the Thai admission year
 *
 * The running part is school-and-term wide rather than per classroom because
 * `uq_student_term_school_term_student_number` is unique at exactly that level —
 * a per-room counter collides as soon as two grades share a room number.
 *
 * Only NULL values are written, so a school that later imports its own codes
 * keeps them, and re-running the script changes nothing.
 */
async function main() {
  await appDataSource.initialize();
  try {
    const [before] = await appDataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE student_number IS NULL)::int AS missing,
        COUNT(*)::int AS total
      FROM student_term
      WHERE deleted_at IS NULL
    `);
    console.log(`before: ${before.total - before.missing}/${before.total} enrollments numbered`);

    if (AUDIT_ONLY) return;

    // One set-based pass: number every blank enrollment within its classroom,
    // ordered by name so the sequence reads naturally on a roster.
    const result = await appDataSource.query(`
      WITH numbered AS (
        SELECT
          enrollment.student_uuid,
          LPAD(
            (
              COALESCE(
                NULLIF(enrollment."SchoolAdmissionYear_Onec", 0),
                enrollment."AcademicYear_Onec"
              ) % 100
            )::text,
            2, '0'
          )
          || LPAD(
            ROW_NUMBER() OVER (
              PARTITION BY
                enrollment."SchoolID_Onec",
                enrollment."AcademicYear_Onec",
                enrollment."Semester_Onec"
              ORDER BY
                enrollment."GradeLevelID_Onec",
                enrollment."RoomID_Onec",
                enrollment."FirstName_Onec",
                enrollment."LastName_Onec",
                enrollment.student_uuid
            )::text,
            6, '0'
          ) AS student_number
        FROM student_term enrollment
        WHERE enrollment.deleted_at IS NULL
          AND enrollment.student_number IS NULL
      )
      UPDATE student_term enrollment
      SET student_number = numbered.student_number
      FROM numbered
      WHERE enrollment.student_uuid = numbered.student_uuid
        AND NOT EXISTS (
          -- The unique index is per school + term; skip a collision rather than
          -- fail the whole run (a school may already own part of the range).
          SELECT 1
          FROM student_term taken
          WHERE taken."SchoolID_Onec" = enrollment."SchoolID_Onec"
            AND taken."AcademicYear_Onec" = enrollment."AcademicYear_Onec"
            AND taken."Semester_Onec" = enrollment."Semester_Onec"
            AND taken.student_number = numbered.student_number
        )
    `);
    const updated = Array.isArray(result) ? (result[1] ?? 0) : 0;

    const [after] = await appDataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE student_number IS NULL)::int AS missing,
        COUNT(*)::int AS total
      FROM student_term
      WHERE deleted_at IS NULL
    `);
    console.log(
      JSON.stringify({
        status: 'student_number_seed_ok',
        updated,
        numbered: after.total - after.missing,
        total: after.total,
        stillMissing: after.missing,
      }),
    );
  } finally {
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});

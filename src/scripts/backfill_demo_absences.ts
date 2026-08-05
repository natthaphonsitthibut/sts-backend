import 'reflect-metadata';
import appDataSource from '../database/typeorm.datasource';
import { RiskProfileRepository } from '../risk-profile/risk-profile.repository';

/**
 * Demo-data helper: turn a spread of existing attendance days into full-day
 * absences so the risk rules have something to find. A day only counts as ขาด
 * when every measured period that day is unattended, so this rewrites whole
 * days rather than single periods.
 *
 * Students are picked at most one per classroom across as many schools as
 * possible, so the map and the ranking chart show a spread instead of one hot
 * classroom. Dev/demo only — it refuses to run with NODE_ENV=production.
 */
const STUDENT_COUNT = Number(process.env.DEMO_ABSENCE_STUDENTS ?? 40);
const ABSENT_DAYS_PER_STUDENT = Number(process.env.DEMO_ABSENCE_DAYS ?? 3);

interface CandidateRow {
  student_uuid: string;
  student_name: string;
  school_name: string | null;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to backfill demo absences with NODE_ENV=production');
  }
  await appDataSource.initialize();
  try {
    // One student per classroom, spread over schools, among those who already
    // have enough recorded days to convert.
    const candidates: CandidateRow[] = await appDataSource.query(
      `
        WITH student_days AS (
          SELECT
            a.student_uuid,
            COUNT(DISTINCT a."AttendanceDate") AS recorded_days
          FROM attendance a
          WHERE a.session_kind = 'SUBJECT'
          GROUP BY a.student_uuid
          HAVING COUNT(DISTINCT a."AttendanceDate") >= $2
        ),
        ranked AS (
          SELECT
            enrollment.student_uuid,
            TRIM(CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec"))
              AS student_name,
            school.name AS school_name,
            ROW_NUMBER() OVER (
              PARTITION BY enrollment.classroom_id ORDER BY random()
            ) AS per_classroom,
            ROW_NUMBER() OVER (
              PARTITION BY enrollment."SchoolID_Onec" ORDER BY random()
            ) AS per_school
          FROM student_days
          JOIN student_term enrollment ON enrollment.student_uuid = student_days.student_uuid
          LEFT JOIN schools school ON school.id = enrollment."SchoolID_Onec"
          WHERE enrollment.deleted_at IS NULL
        )
        SELECT student_uuid::text, student_name, school_name
        FROM ranked
        WHERE per_classroom = 1
        ORDER BY per_school, random()
        LIMIT $1
      `,
      [STUDENT_COUNT, ABSENT_DAYS_PER_STUDENT],
    );

    if (candidates.length === 0) {
      console.log('No candidate students found — nothing to backfill.');
      return;
    }

    let updatedDays = 0;
    for (const candidate of candidates) {
      const result: Array<{ attendance_date: string }> = await appDataSource.query(
        `
          WITH target_days AS (
            SELECT DISTINCT a."AttendanceDate" AS attendance_date
            FROM attendance a
            WHERE a.student_uuid = $1
              AND a.session_kind = 'SUBJECT'
            ORDER BY a."AttendanceDate" DESC
            LIMIT $2
          )
          UPDATE attendance a
          SET "AttendanceStatus" = 2
          FROM target_days
          WHERE a.student_uuid = $1
            AND a.session_kind = 'SUBJECT'
            AND a."AttendanceDate" = target_days.attendance_date
          RETURNING a."AttendanceDate"::text AS attendance_date
        `,
        [candidate.student_uuid, ABSENT_DAYS_PER_STUDENT],
      );
      const days = new Set(result.map((row) => row.attendance_date)).size;
      updatedDays += days;
      console.log(
        `  ${candidate.student_name} (${candidate.school_name ?? 'ไม่ทราบโรงเรียน'}): ${days} วัน`,
      );
    }

    console.log(`Marked ${updatedDays} full-day absences across ${candidates.length} students.`);

    const repository = new RiskProfileRepository(appDataSource);
    const thresholds = await repository.getRiskThresholds();
    const recalculated = await repository.recalculateStudents(
      candidates.map((candidate) => candidate.student_uuid),
      thresholds,
    );
    console.log(
      `Risk recalculation: evaluated=${recalculated.evaluated}, changed=${recalculated.changed}`,
    );
    const distribution: Array<{ risk_tier: string; count: number }> = await appDataSource.query(
      'SELECT risk_tier, COUNT(*)::int AS count FROM student_risk_profiles GROUP BY 1 ORDER BY 1',
    );
    for (const row of distribution) {
      console.log(`  ${row.risk_tier}: ${row.count}`);
    }
  } finally {
    await appDataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

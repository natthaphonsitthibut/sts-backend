const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { RiskProfileRepository } = require('../dist/risk-profile/risk-profile.repository');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run demo attendance history seed with NODE_ENV=production');
}

const LOOKBACK_DAYS = 45;
const SKIP_RISK_RECALCULATION = process.argv.includes('--skip-risk-recalculation');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  try {
    const result = await dataSource.transaction(async (manager) => {
      const [sessionStats] = await manager.query(
        `
          WITH active_terms AS (
            SELECT id AS term_id, school_id, academic_year, semester, starts_on, ends_on
            FROM school_terms
            WHERE status = 'ACTIVE' AND deleted_at IS NULL
          ),
          window_days AS (
            SELECT t.term_id, t.school_id, t.academic_year, t.semester,
              d::date AS attendance_date
            FROM active_terms t,
              generate_series(
                GREATEST(t.starts_on, (CURRENT_DATE - ($1::int * INTERVAL '1 day'))::date),
                LEAST(t.ends_on, CURRENT_DATE),
                INTERVAL '1 day'
              ) AS d
            WHERE EXTRACT(ISODOW FROM d) < 6
          ),
          school_days AS (
            SELECT w.* FROM window_days w
            WHERE NOT EXISTS (
              SELECT 1 FROM school_calendar_days c
              WHERE c.school_term_id = w.term_id
                AND c.calendar_date = w.attendance_date
                AND c.day_type <> 'SCHOOL_DAY'
                AND c.deleted_at IS NULL
            )
          ),
          roster AS (
            SELECT st."SchoolID_Onec" AS school_id, st."AcademicYear_Onec" AS academic_year,
              st."Semester_Onec" AS semester, st."GradeLevelID_Onec" AS grade_level_id,
              st."RoomID_Onec"::int AS room_id, st.student_uuid
            FROM student_term st
            WHERE st.deleted_at IS NULL AND st.student_uuid IS NOT NULL
              AND EXISTS (SELECT 1 FROM grade_levels g WHERE g.id = st."GradeLevelID_Onec")
          ),
          room_days AS (
            SELECT sd.term_id, sd.attendance_date, r.school_id, r.academic_year, r.semester,
              r.grade_level_id, r.room_id, COUNT(*)::int AS roster_count
            FROM school_days sd
            JOIN roster r ON r.school_id = sd.school_id
              AND r.academic_year = sd.academic_year AND r.semester = sd.semester
            GROUP BY 1, 2, 3, 4, 5, 6, 7
          ),
          homeroom_teachers AS (
            SELECT DISTINCT ON (ts.school_term_id, ts.school_id, ts.grade_level_id, ts.room_no)
              ts.school_term_id, ts.school_id, ts.grade_level_id, ts.room_no,
              teacher.id AS teacher_user_id
            FROM timetable_slots ts
            JOIN users teacher
              ON teacher.id = ts.teacher_user_id
             AND teacher.role = 'TEACHER'
             AND teacher.status = 'ACTIVE'
             AND teacher.data_origin_code = 'DEMO'
            WHERE ts.deleted_at IS NULL AND ts.period = 1 AND ts.teacher_user_id IS NOT NULL
            ORDER BY ts.school_term_id, ts.school_id, ts.grade_level_id, ts.room_no, ts.day_of_week
          )
          INSERT INTO attendance_sessions (
            school_term_id, school_id, grade_level_id, room_id, attendance_date,
            period, session_kind, status, expected_roster_count, recorded_count,
            submitted_at, submitted_by, created_by, updated_by
          )
          SELECT rd.term_id, rd.school_id, rd.grade_level_id, rd.room_id, rd.attendance_date,
            1, 'DAILY', 'SUBMITTED', rd.roster_count, rd.roster_count,
            rd.attendance_date + TIME '15:00', ht.teacher_user_id,
            ht.teacher_user_id, ht.teacher_user_id
          FROM room_days rd
          JOIN homeroom_teachers ht ON ht.school_term_id = rd.term_id
            AND ht.school_id = rd.school_id AND ht.grade_level_id = rd.grade_level_id
            AND ht.room_no = rd.room_id
          ON CONFLICT (school_term_id, grade_level_id, room_id, attendance_date, period, session_kind)
          DO UPDATE SET
            status = 'SUBMITTED',
            expected_roster_count = EXCLUDED.expected_roster_count,
            recorded_count = EXCLUDED.recorded_count,
            submitted_at = EXCLUDED.submitted_at,
            submitted_by = EXCLUDED.submitted_by,
            created_by = EXCLUDED.created_by,
            updated_by = EXCLUDED.updated_by,
            deleted_at = NULL,
            deleted_by = NULL
          RETURNING id
        `,
        [LOOKBACK_DAYS],
      ).then((rows) => [{ sessions: rows.length }]);

      const [attendanceStats] = await manager.query(
        `
          WITH active_terms AS (
            SELECT id AS term_id, school_id, academic_year, semester, starts_on, ends_on
            FROM school_terms
            WHERE status = 'ACTIVE' AND deleted_at IS NULL
          ),
          window_days AS (
            SELECT t.term_id, t.school_id, t.academic_year, t.semester,
              d::date AS attendance_date
            FROM active_terms t,
              generate_series(
                GREATEST(t.starts_on, (CURRENT_DATE - ($1::int * INTERVAL '1 day'))::date),
                LEAST(t.ends_on, CURRENT_DATE),
                INTERVAL '1 day'
              ) AS d
            WHERE EXTRACT(ISODOW FROM d) < 6
          ),
          school_days AS (
            SELECT w.* FROM window_days w
            WHERE NOT EXISTS (
              SELECT 1 FROM school_calendar_days c
              WHERE c.school_term_id = w.term_id
                AND c.calendar_date = w.attendance_date
                AND c.day_type <> 'SCHOOL_DAY'
                AND c.deleted_at IS NULL
            )
          ),
          roster AS (
            SELECT st."SchoolID_Onec" AS school_id, st."AcademicYear_Onec" AS academic_year,
              st."Semester_Onec" AS semester, st."GradeLevelID_Onec" AS grade_level_id,
              st."RoomID_Onec"::int AS room_id, st.student_uuid
            FROM student_term st
            WHERE st.deleted_at IS NULL AND st.student_uuid IS NOT NULL
              AND EXISTS (SELECT 1 FROM grade_levels g WHERE g.id = st."GradeLevelID_Onec")
          ),
          roster_days AS (
            SELECT sd.term_id, sd.attendance_date, r.school_id, r.academic_year, r.semester,
              r.grade_level_id, r.room_id, r.student_uuid
            FROM school_days sd
            JOIN roster r ON r.school_id = sd.school_id
              AND r.academic_year = sd.academic_year AND r.semester = sd.semester
          ),
          scored AS (
            SELECT rd.*,
              abs(hashtext(rd.student_uuid::text)) % 100 AS archetype_roll,
              abs(hashtext(rd.student_uuid::text || rd.attendance_date::text)) % 1000 AS day_roll
            FROM roster_days rd
          ),
          statused AS (
            SELECT *,
              CASE
                WHEN archetype_roll < 70 THEN
                  CASE WHEN day_roll < 970 THEN 1 WHEN day_roll < 990 THEN 3 ELSE 2 END
                WHEN archetype_roll < 85 THEN
                  CASE WHEN day_roll < 900 THEN 1 WHEN day_roll < 950 THEN 3 ELSE 2 END
                WHEN archetype_roll < 95 THEN
                  CASE WHEN day_roll < 800 THEN 1 WHEN day_roll < 850 THEN 3 ELSE 2 END
                ELSE
                  CASE WHEN day_roll < 600 THEN 1 WHEN day_roll < 650 THEN 3 ELSE 2 END
              END AS attendance_status
            FROM scored
          )
          INSERT INTO attendance (
            student_uuid, "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
            "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period",
            "AttendanceStatus", "RecordedAt", "RecordedBy", session_id,
            created_by, updated_by
          )
          SELECT s.student_uuid, s.school_id, s.grade_level_id, s.room_id,
            s.academic_year, s.semester, s.attendance_date, 1,
            s.attendance_status, s.attendance_date + TIME '15:00',
            recorder.username, sess.id, sess.submitted_by, sess.submitted_by
          FROM statused s
          JOIN attendance_sessions sess ON sess.school_term_id = s.term_id
            AND sess.grade_level_id = s.grade_level_id AND sess.room_id = s.room_id
            AND sess.attendance_date = s.attendance_date AND sess.period = 1
            AND sess.session_kind = 'DAILY'
          JOIN users recorder ON recorder.id = sess.submitted_by
          ON CONFLICT (student_uuid, "AttendanceDate") WHERE session_kind = 'DAILY'
          DO UPDATE SET
            "AttendanceStatus" = EXCLUDED."AttendanceStatus",
            "RecordedAt" = EXCLUDED."RecordedAt",
            "RecordedBy" = EXCLUDED."RecordedBy",
            session_id = EXCLUDED.session_id,
            created_by = EXCLUDED.created_by,
            updated_by = EXCLUDED.updated_by
          RETURNING "AttendanceID"
        `,
        [LOOKBACK_DAYS],
      ).then((rows) => [{ records: rows.length }]);

      await manager.query(`
        UPDATE student_term student
        SET "GPAX_Onec" = ROUND(
          2.40 + (
            MOD(
              ABS(hashtextextended(COALESCE(student.person_uuid, student.student_uuid)::text, 17)),
              151
            )::numeric / 100
          ),
          2
        )::real
        FROM school_terms term
        WHERE term.school_id = student."SchoolID_Onec"
          AND term.academic_year = student."AcademicYear_Onec"
          AND term.semester = student."Semester_Onec"
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
          AND student.deleted_at IS NULL
          AND student."GPAX_Onec" IS NULL
      `);
      await manager.query(`
        UPDATE student_term student
        SET term_gpa = ROUND(LEAST(4.00, GREATEST(
          0.00,
          COALESCE(student."GPAX_Onec"::numeric, 2.75)
            + ((MOD(ABS(hashtextextended(student.student_uuid::text, 0)), 41) - 20)::numeric / 100)
        )), 2)
        FROM school_terms term
        WHERE term.school_id = student."SchoolID_Onec"
          AND term.academic_year = student."AcademicYear_Onec"
          AND term.semester = student."Semester_Onec"
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
          AND student.deleted_at IS NULL
          AND student.term_gpa IS NULL
      `);
      const [gpaStats] = await manager.query(`
        SELECT
          COUNT(*) FILTER (WHERE student.term_gpa IS NOT NULL)::int AS term_profiles,
          COUNT(*) FILTER (WHERE student."GPAX_Onec" IS NOT NULL)::int AS cumulative_profiles
        FROM student_term student
        JOIN school_terms term ON term.school_id = student."SchoolID_Onec"
          AND term.academic_year = student."AcademicYear_Onec"
          AND term.semester = student."Semester_Onec"
        WHERE term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
          AND student.deleted_at IS NULL
      `);

      const [subjectSessionStats] = await manager.query(
        `
          WITH active_terms AS (
            SELECT id AS term_id, school_id, academic_year, semester, starts_on, ends_on
            FROM school_terms
            WHERE status = 'ACTIVE' AND deleted_at IS NULL
          ),
          school_days AS (
            SELECT term.*, day_value::date AS attendance_date
            FROM active_terms term,
              generate_series(
                GREATEST(term.starts_on, (CURRENT_DATE - ($1::int * INTERVAL '1 day'))::date),
                LEAST(term.ends_on, CURRENT_DATE),
                INTERVAL '1 day'
              ) AS day_value
            WHERE EXTRACT(ISODOW FROM day_value) < 6
              AND NOT EXISTS (
                SELECT 1 FROM school_calendar_days calendar
                WHERE calendar.school_term_id = term.term_id
                  AND calendar.calendar_date = day_value::date
                  AND calendar.day_type <> 'SCHOOL_DAY'
                  AND calendar.deleted_at IS NULL
              )
          ),
          roster_counts AS (
            SELECT student."SchoolID_Onec" AS school_id,
              student."AcademicYear_Onec" AS academic_year,
              student."Semester_Onec" AS semester,
              student."GradeLevelID_Onec" AS grade_level_id,
              student."RoomID_Onec"::int AS room_id,
              COUNT(*)::int AS roster_count
            FROM student_term student
            WHERE student.deleted_at IS NULL AND student.student_uuid IS NOT NULL
            GROUP BY 1, 2, 3, 4, 5
          )
          INSERT INTO attendance_sessions (
            school_term_id, school_id, grade_level_id, room_id, attendance_date,
            period, session_kind, subject_id, timetable_slot_id, status,
            expected_roster_count, recorded_count, submitted_at, submitted_by,
            created_by, updated_by
          )
          SELECT day.term_id, day.school_id, slot.grade_level_id, slot.room_no,
            day.attendance_date, slot.period, 'SUBJECT', slot.subject_id, slot.id,
            'SUBMITTED', roster.roster_count, roster.roster_count,
            day.attendance_date + TIME '15:00', slot.teacher_user_id,
            slot.teacher_user_id, slot.teacher_user_id
          FROM school_days day
          JOIN timetable_slots slot ON slot.school_term_id = day.term_id
            AND slot.school_id = day.school_id
            AND slot.day_of_week = EXTRACT(ISODOW FROM day.attendance_date)::int
            AND slot.deleted_at IS NULL
            AND slot.subject_id IS NOT NULL
            AND slot.teacher_user_id IS NOT NULL
          JOIN users teacher ON teacher.id = slot.teacher_user_id AND teacher.status = 'ACTIVE'
          JOIN roster_counts roster ON roster.school_id = day.school_id
            AND roster.academic_year = day.academic_year
            AND roster.semester = day.semester
            AND roster.grade_level_id = slot.grade_level_id
            AND roster.room_id = slot.room_no
          ON CONFLICT (school_term_id, grade_level_id, room_id, attendance_date, period, session_kind)
          DO UPDATE SET
            subject_id = EXCLUDED.subject_id,
            timetable_slot_id = EXCLUDED.timetable_slot_id,
            status = EXCLUDED.status,
            expected_roster_count = EXCLUDED.expected_roster_count,
            recorded_count = EXCLUDED.recorded_count,
            submitted_at = EXCLUDED.submitted_at,
            submitted_by = EXCLUDED.submitted_by,
            updated_by = EXCLUDED.updated_by,
            deleted_at = NULL,
            deleted_by = NULL
          RETURNING id
        `,
        [LOOKBACK_DAYS],
      ).then((rows) => [{ sessions: rows.length }]);

      const [subjectAttendanceStats] = await manager.query(`
        WITH subject_roster AS (
          SELECT session.id AS session_id, session.school_id, session.grade_level_id,
            session.room_id, session.attendance_date, session.period,
            student.student_uuid, student."AcademicYear_Onec" AS academic_year,
            student."Semester_Onec" AS semester, teacher.username AS recorded_by,
            session.submitted_by
          FROM attendance_sessions session
          JOIN school_terms term ON term.id = session.school_term_id
          JOIN student_term student ON student."SchoolID_Onec" = session.school_id
            AND student."AcademicYear_Onec" = term.academic_year
            AND student."Semester_Onec" = term.semester
            AND student."GradeLevelID_Onec" = session.grade_level_id
            AND student."RoomID_Onec"::int = session.room_id
            AND student.deleted_at IS NULL
          JOIN users teacher ON teacher.id = session.submitted_by
          WHERE session.session_kind = 'SUBJECT'
            AND session.status = 'SUBMITTED'
            AND session.deleted_at IS NULL
        ),
        scored AS (
          SELECT subject_roster.*,
            MOD(ABS(hashtextextended(
              student_uuid::text || attendance_date::text || period::text,
              0
            )), 100) AS subject_roll
          FROM subject_roster
        )
        INSERT INTO attendance (
          student_uuid, "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
          "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period",
          "AttendanceStatus", "RecordedAt", "RecordedBy", session_id,
          session_kind, created_by, updated_by
        )
        SELECT student_uuid, school_id, grade_level_id, room_id, academic_year,
          semester, attendance_date, period,
          CASE
            WHEN subject_roll < 6 THEN 2
            WHEN subject_roll < 12 THEN 3
            WHEN subject_roll < 16 THEN 4
            ELSE 1
          END,
          attendance_date + TIME '15:00', recorded_by, session_id,
          'SUBJECT', submitted_by, submitted_by
        FROM scored
        ON CONFLICT (student_uuid, "AttendanceDate", "Period")
          WHERE session_kind = 'SUBJECT'
        DO UPDATE SET
          "AttendanceStatus" = EXCLUDED."AttendanceStatus",
          "RecordedAt" = EXCLUDED."RecordedAt",
          "RecordedBy" = EXCLUDED."RecordedBy",
          session_id = EXCLUDED.session_id,
          created_by = EXCLUDED.created_by,
          updated_by = EXCLUDED.updated_by
        RETURNING "AttendanceID"
      `).then((rows) => [{ records: rows.length }]);

      return {
        dailySessions: sessionStats.sessions,
        dailyRecords: attendanceStats.records,
        profileTermGpas: Number(gpaStats.term_profiles ?? 0),
        profileCumulativeGpaxes: Number(gpaStats.cumulative_profiles ?? 0),
        subjectSessions: subjectSessionStats.sessions,
        subjectRecords: subjectAttendanceStats.records,
      };
    });

    let profilesUpdated = null;
    if (!SKIP_RISK_RECALCULATION) {
      const riskProfileRepository = app.get(RiskProfileRepository);
      const thresholds = await riskProfileRepository.getRiskThresholds();
      profilesUpdated = await riskProfileRepository.recalculateAll(thresholds);
    }

    console.log(
      JSON.stringify({
        status: 'demo_attendance_history_seeded',
        ...result,
        profilesUpdated,
        riskProfileRecalculationSkipped: SKIP_RISK_RECALCULATION,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Demo attendance history seed failed');
  process.exitCode = 1;
});

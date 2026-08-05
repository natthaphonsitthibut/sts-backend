const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run attendance anomaly seed with NODE_ENV=production');
}

const DEMO_START = '2026-06-01';
const DEMO_END = '2026-06-28';
const TARGET_SCHOOL_ID = 10010003;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return isoDate(date);
}

function eachDate(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(isoDate(cursor));
    cursor.setTime(cursor.getTime() + DAY_MS);
  }
  return dates;
}

function isoDay(value) {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function firstDateMatching(start, end, predicate, fallbackOffset = 0) {
  const dates = eachDate(start, end);
  return dates.find(predicate) ?? dates[Math.min(fallbackOffset, Math.max(0, dates.length - 1))];
}

async function queryOne(dataSource, sql, params = []) {
  const rows = await dataSource.query(sql, params);
  return rows[0] ?? null;
}

async function findActiveFixture(dataSource) {
  return await queryOne(
    dataSource,
    `
      SELECT term.id AS term_id, term.school_id, school.name AS school_name,
        term.academic_year, term.semester, term.starts_on::text, term.ends_on::text,
        roster.grade_level_id, grade.label AS grade_label, roster.room_id, roster.roster_count
      FROM school_terms term
      JOIN schools school ON school.id = term.school_id
      JOIN (
        SELECT "SchoolID_Onec" AS school_id, "AcademicYear_Onec" AS academic_year,
          "Semester_Onec" AS semester, "GradeLevelID_Onec" AS grade_level_id,
          "RoomID_Onec"::int AS room_id, COUNT(*)::int AS roster_count
        FROM student_term
        WHERE deleted_at IS NULL AND student_uuid IS NOT NULL
        GROUP BY 1, 2, 3, 4, 5
        HAVING COUNT(*) >= 2
      ) roster ON roster.school_id = term.school_id
        AND roster.academic_year = term.academic_year
        AND roster.semester = term.semester
      JOIN grade_levels grade ON grade.id = roster.grade_level_id
      WHERE term.status = 'ACTIVE'
        AND term.deleted_at IS NULL
        AND term.starts_on IS NOT NULL
        AND term.ends_on IS NOT NULL
      ORDER BY CASE WHEN term.school_id = $1 THEN 0 ELSE 1 END,
        roster.roster_count DESC, term.id
      LIMIT 1
    `,
    [TARGET_SCHOOL_ID],
  );
}

async function findRosterFixture(dataSource) {
  return await queryOne(
    dataSource,
    `
      SELECT school.id AS school_id, school.name AS school_name,
        roster.academic_year, roster.semester, roster.grade_level_id,
        grade.label AS grade_label, roster.room_id, roster.roster_count
      FROM (
        SELECT "SchoolID_Onec" AS school_id, "AcademicYear_Onec" AS academic_year,
          "Semester_Onec" AS semester, "GradeLevelID_Onec" AS grade_level_id,
          "RoomID_Onec"::int AS room_id, COUNT(*)::int AS roster_count
        FROM student_term
        WHERE deleted_at IS NULL AND student_uuid IS NOT NULL
        GROUP BY 1, 2, 3, 4, 5
        HAVING COUNT(*) >= 2
      ) roster
      JOIN schools school ON school.id = roster.school_id
      JOIN grade_levels grade ON grade.id = roster.grade_level_id
      WHERE NOT EXISTS (
        SELECT 1 FROM school_terms term
        WHERE term.school_id = roster.school_id
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
      )
      ORDER BY CASE WHEN roster.school_id = $1 THEN 0 ELSE 1 END,
        roster.roster_count DESC, roster.school_id
      LIMIT 1
    `,
    [TARGET_SCHOOL_ID],
  );
}

async function ensureDemoTerm(dataSource, fixture, actorId) {
  const term = await queryOne(
    dataSource,
    `
      INSERT INTO school_terms (
        school_id, academic_year, semester, starts_on, ends_on, status, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $6)
      ON CONFLICT (school_id, academic_year, semester) DO UPDATE SET
        starts_on = EXCLUDED.starts_on,
        ends_on = EXCLUDED.ends_on,
        status = 'DRAFT',
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
      RETURNING id, starts_on::text, ends_on::text
    `,
    [
      fixture.school_id,
      fixture.academic_year,
      fixture.semester,
      DEMO_START,
      DEMO_END,
      actorId,
    ],
  );
  const calendarRows = eachDate(DEMO_START, DEMO_END).map((date) => ({
    date,
    dayType: isoDay(date) <= 5 ? 'SCHOOL_DAY' : 'HOLIDAY',
  }));
  await dataSource.query(
    `
      INSERT INTO school_calendar_days (
        school_term_id, calendar_date, day_type, reason, source, created_by, updated_by
      )
      SELECT $1, input.calendar_date::date, input.day_type, NULL, 'GENERATED', $2, $2
      FROM jsonb_to_recordset($3::jsonb) AS input(calendar_date text, day_type text)
      ON CONFLICT (school_term_id, calendar_date) DO UPDATE SET
        day_type = EXCLUDED.day_type,
        reason = NULL,
        source = 'GENERATED',
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
    `,
    [term.id, actorId, JSON.stringify(calendarRows)],
  );
  await dataSource.query(`UPDATE school_terms SET status = 'ACTIVE', updated_by = $2 WHERE id = $1`, [
    term.id,
    actorId,
  ]);
  return { ...fixture, term_id: term.id, starts_on: term.starts_on, ends_on: term.ends_on };
}

async function markCalendarDay(dataSource, termId, date, dayType, reason, actorId) {
  await dataSource.query(
    `
      INSERT INTO school_calendar_days (
        school_term_id, calendar_date, day_type, reason, source, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, 'MANUAL', $5, $5)
      ON CONFLICT (school_term_id, calendar_date) DO UPDATE SET
        day_type = EXCLUDED.day_type,
        reason = EXCLUDED.reason,
        source = 'MANUAL',
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
    `,
    [termId, date, dayType, reason, actorId],
  );
}

async function createSession(dataSource, fixture, date, actor, roster) {
  const session = await queryOne(
    dataSource,
    `
      INSERT INTO attendance_sessions (
        school_term_id, school_id, grade_level_id, room_id, attendance_date,
        period, session_kind, status, expected_roster_count, recorded_count,
        submitted_at, submitted_by, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 1, 'DAILY', 'SUBMITTED', $6, $6, now(), $7, $7, $7)
      ON CONFLICT (school_term_id, grade_level_id, room_id, attendance_date, period, session_kind)
      DO UPDATE SET
        status = 'SUBMITTED',
        expected_roster_count = EXCLUDED.expected_roster_count,
        recorded_count = EXCLUDED.recorded_count,
        submitted_at = now(),
        submitted_by = EXCLUDED.submitted_by,
        created_by = EXCLUDED.created_by,
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
      RETURNING id
    `,
    [
      fixture.term_id,
      fixture.school_id,
      fixture.grade_level_id,
      fixture.room_id,
      date,
      roster.length,
      actor.id,
    ],
  );
  await dataSource.query(
    `
      INSERT INTO attendance (
        student_uuid, "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
        "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period",
        "AttendanceStatus", "RecordedAt", "RecordedBy", session_id,
        created_by, updated_by
      )
      SELECT input.student_uuid::uuid, $2, $3, $4, $5, $6, $7, 1, 1, now(), $8, $9, $10, $10
      FROM UNNEST($1::uuid[]) AS input(student_uuid)
      ON CONFLICT (student_uuid, "AttendanceDate") WHERE session_kind = 'DAILY'
      DO UPDATE SET
        "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
        "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
        "RoomID_Onec" = EXCLUDED."RoomID_Onec",
        "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
        "Semester_Onec" = EXCLUDED."Semester_Onec",
        "AttendanceStatus" = EXCLUDED."AttendanceStatus",
        "RecordedAt" = now(),
        "RecordedBy" = EXCLUDED."RecordedBy",
        session_id = EXCLUDED.session_id,
        created_by = EXCLUDED.created_by,
        updated_by = EXCLUDED.updated_by
    `,
    [
      roster,
      fixture.school_id,
      fixture.grade_level_id,
      fixture.room_id,
      fixture.academic_year,
      fixture.semester,
      date,
      actor.username,
      session.id,
      actor.id,
    ],
  );
  return session.id;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  try {
    const structuralActor = await queryOne(
      dataSource,
      `
        SELECT id, username
        FROM users
        WHERE username = 'orathai.b'
          AND role = 'ADMIN'
          AND status = 'ACTIVE'
          AND data_origin_code = 'DEMO'
        LIMIT 1
      `,
    );
    if (!structuralActor?.id) {
      throw new Error('No active DEMO administrator is available for seed attribution');
    }

    let fixture = await findActiveFixture(dataSource);
    if (!fixture) {
      const rosterFixture = await findRosterFixture(dataSource);
      if (!rosterFixture) throw new Error('No roster fixture without active term is available');
      fixture = await ensureDemoTerm(dataSource, rosterFixture, structuralActor.id);
    }
    const attendanceActor = await queryOne(
      dataSource,
      `
        SELECT teacher.id, teacher.username
        FROM school_classrooms classroom
        JOIN classroom_teacher_assignments assignment
          ON assignment.classroom_id = classroom.id
         AND assignment.assignment_kind = 'HOMEROOM'
         AND assignment.assignment_status = 'ACTIVE'
         AND assignment.deleted_at IS NULL
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
         AND membership.school_id = assignment.school_id
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        JOIN users teacher
          ON teacher.id = membership.teacher_user_id
         AND teacher.role = 'TEACHER'
         AND teacher.status = 'ACTIVE'
         AND teacher.data_origin_code = 'DEMO'
        WHERE classroom.school_term_id = $1
          AND classroom.school_id = $2
          AND classroom.grade_level_id = $3
          AND classroom.legacy_room_number = $4
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
        ORDER BY assignment.effective_on DESC, assignment.id DESC
        LIMIT 1
      `,
      [fixture.term_id, fixture.school_id, fixture.grade_level_id, fixture.room_id],
    );
    if (!attendanceActor?.id) {
      throw new Error('No active DEMO teacher is available in the selected school');
    }

    const rosterRows = await dataSource.query(
      `
        SELECT student_uuid
        FROM student_term
        WHERE "SchoolID_Onec" = $1
          AND "AcademicYear_Onec" = $2
          AND "Semester_Onec" = $3
          AND "GradeLevelID_Onec" = $4
          AND "RoomID_Onec"::int = $5
          AND deleted_at IS NULL
          AND student_uuid IS NOT NULL
        ORDER BY student_uuid
      `,
      [
        fixture.school_id,
        fixture.academic_year,
        fixture.semester,
        fixture.grade_level_id,
        fixture.room_id,
      ],
    );
    const roster = rosterRows.map((row) => row.student_uuid);
    if (roster.length < 2) throw new Error('Selected fixture roster is too small');

    const holidayDate = firstDateMatching(
      fixture.starts_on,
      fixture.ends_on,
      (date) => isoDay(date) >= 6,
      0,
    );
    const cancelledDate = firstDateMatching(
      fixture.starts_on,
      fixture.ends_on,
      (date) => isoDay(date) <= 5 && date !== holidayDate,
      1,
    );
    const missingCalendarDate = firstDateMatching(
      fixture.starts_on,
      fixture.ends_on,
      (date) => date !== holidayDate && date !== cancelledDate,
      2,
    );
    const outOfTermDate = addDays(fixture.starts_on, -1);

    await dataSource.transaction(async (manager) => {
      await markCalendarDay(
        manager,
        fixture.term_id,
        holidayDate,
        'HOLIDAY',
        'วันหยุดตามปฏิทินโรงเรียน',
        structuralActor.id,
      );
      await markCalendarDay(
        manager,
        fixture.term_id,
        cancelledDate,
        'CANCELLED',
        'ยกเลิกการเรียนการสอน',
        structuralActor.id,
      );
      await manager.query(
        `
          UPDATE school_calendar_days
          SET deleted_at = now(), deleted_by = $3, updated_by = $3
          WHERE school_term_id = $1 AND calendar_date = $2 AND deleted_at IS NULL
        `,
        [fixture.term_id, missingCalendarDate, structuralActor.id],
      );
      await createSession(manager, fixture, holidayDate, attendanceActor, roster);
      await createSession(manager, fixture, cancelledDate, attendanceActor, roster);
      await createSession(manager, fixture, missingCalendarDate, attendanceActor, roster);
      await createSession(manager, fixture, outOfTermDate, attendanceActor, roster);
    });

    console.log(JSON.stringify({
      status: 'attendance_anomalies_seeded',
      schoolId: fixture.school_id,
      schoolName: fixture.school_name,
      termId: fixture.term_id,
      grade: fixture.grade_label,
      room: fixture.room_id,
      dates: {
        holidayAttendance: holidayDate,
        cancelledAttendance: cancelledDate,
        missingCalendarDay: missingCalendarDate,
        outOfTerm: outOfTermDate,
      },
      rosterCount: roster.length,
    }));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Attendance anomaly seed failed');
  process.exitCode = 1;
});

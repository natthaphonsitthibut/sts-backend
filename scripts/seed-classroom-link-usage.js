const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const {
  ExceptionAttendanceService,
} = require('../dist/attendance/exception-attendance.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed link usage with NODE_ENV=production');
}

const APPLY = process.argv.includes('--apply');
const arg = (name, fallback) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : fallback;
};

const TEACHER_FIRST_NAME = arg('first', 'กมลชนก');
const TEACHER_LAST_NAME = arg('last', 'รุ่งเรือง');
const ROOM = arg('room', 'ป.2/2');
const SUBJECT = arg('subject', 'การงานอาชีพ');
const SESSION_COUNT = Number(arg('sessions', '12'));
const OPEN_COUNT = Number(arg('opens', '18'));

/**
 * Fills one assignment link with the history a busy one would have.
 *
 * The link-usage page answers two questions — who opened this link, and what
 * registers were taken through it — and both are only worth looking at with a
 * fortnight of traffic behind them. On a fresh database there is one of each,
 * so the page cannot be judged.
 *
 * Nothing here is invented. The teacher, the room, the lesson, the students and
 * the other teachers who pick the link up are all rows already in the database,
 * and the registers are written by calling `ExceptionAttendanceService.start`
 * and `.submit` — the same two methods the check-in screen calls — with the
 * actor a classroom link builds. That matters more than it sounds: a session
 * assembled with hand-written SQL would miss the roster snapshot, the exception
 * rows, the counters and the audit entries the page and every report read, and
 * would look right on this one screen while being wrong everywhere else.
 *
 * The openings are the one thing with no service behind them — the real path
 * runs through a Google or AraID exchange that cannot be replayed offline — so
 * they are written with exactly the action, target and metadata
 * `authorizeToken` writes, and nothing else. They go in with raw SQL for one
 * reason: an event log stamps itself `now()`, and eighteen openings all landing
 * in the same second is the one detail that would give the fixture away. The
 * timestamps are spread across the days the registers were taken; every other
 * column is what the service would have written.
 *
 * The registers get the same treatment after the fact: `start` and `submit`
 * stamp the wall clock, so once each session is written its two moments are
 * moved onto its own attendance date. Nothing but the clock is touched.
 *
 * Read-only unless `--apply` is passed.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const attendance = app.get(ExceptionAttendanceService);

  try {
    const [target] = await dataSource.query(
      `SELECT link.id::text AS link_id,
              link.school_id,
              link.school_term_id::text AS term_id,
              link.assigned_classroom_id::text AS classroom_id,
              link.assigned_classroom_subject_id::text AS offering_id,
              link.opens_at, link.expires_at, link.link_status,
              membership.id::text AS issuer_membership_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS issuer_name,
              grade.label || '/' || classroom.room_code AS room,
              subject.name_th AS subject_name,
              term.starts_on::text AS term_starts_on,
              term.ends_on::text AS term_ends_on
       FROM classroom_attendance_links link
       JOIN school_teacher_memberships membership
         ON membership.id = link.issued_by_teacher_membership_id
       JOIN teachers teacher ON teacher.id = membership.teacher_id
       JOIN school_classrooms classroom ON classroom.id = link.assigned_classroom_id
       JOIN grade_levels grade ON grade.id = classroom.grade_level_id
       JOIN classroom_subjects offering ON offering.id = link.assigned_classroom_subject_id
       JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
       JOIN subjects subject ON subject.id = school_subject.subject_id
       JOIN school_terms term ON term.id = link.school_term_id
       WHERE teacher.first_name = $1
         AND teacher.last_name = $2
         AND grade.label || '/' || classroom.room_code = $3
         AND subject.name_th = $4
       ORDER BY link.issued_at DESC
       LIMIT 1`,
      [TEACHER_FIRST_NAME, TEACHER_LAST_NAME, ROOM, SUBJECT],
    );
    if (!target) {
      throw new Error(
        `No assignment link issued by ${TEACHER_FIRST_NAME} ${TEACHER_LAST_NAME} for ${ROOM} · ${SUBJECT}. Create one from the check-in page first.`,
      );
    }

    // Whoever else teaches at this school is who a link gets handed to. Their
    // own issuer is included: a teacher opens their own link too.
    const pickers = await dataSource.query(
      `SELECT membership.id::text AS membership_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS name
       FROM school_teacher_memberships membership
       JOIN teachers teacher ON teacher.id = membership.teacher_id
        AND teacher.teacher_status = 'ACTIVE'
        AND teacher.deleted_at IS NULL
       WHERE membership.school_id = $1
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
       ORDER BY membership.id
       LIMIT 6`,
      [target.school_id],
    );
    if (pickers.length === 0) throw new Error('No active teachers at this school');

    const roster = await dataSource.query(
      `SELECT resolution.selected_student_uuid::text AS student_uuid
       FROM student_term enrollment
       JOIN student_current_enrollment_resolution resolution
         ON resolution.person_uuid = enrollment.person_uuid
        AND resolution.selected_student_uuid = enrollment.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       WHERE enrollment.classroom_id = $1
         AND enrollment.deleted_at IS NULL
       ORDER BY enrollment.student_uuid`,
      [target.classroom_id],
    );
    if (roster.length === 0) throw new Error('The classroom has no active students');

    // School days inside the term and not already taken: the unique index holds
    // one register per lesson per day, and this room already has some.
    const taken = new Set(
      (
        await dataSource.query(
          `SELECT attendance_date::text AS d FROM attendance_sessions
           WHERE classroom_id = $1 AND classroom_subject_id = $2 AND deleted_at IS NULL`,
          [target.classroom_id, target.offering_id],
        )
      ).map((row) => row.d),
    );
    const today = new Date().toISOString().slice(0, 10);
    const firstDay =
      target.term_starts_on > '2000-01-01' ? target.term_starts_on : '2026-05-16';
    const lastDay = today < target.term_ends_on ? today : target.term_ends_on;
    const dates = [];
    for (
      let day = new Date(`${lastDay}T00:00:00Z`);
      dates.length < SESSION_COUNT && day >= new Date(`${firstDay}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 1)
    ) {
      const iso = day.toISOString().slice(0, 10);
      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      if (taken.has(iso)) continue;
      dates.push(iso);
    }
    dates.reverse();

    console.log(
      JSON.stringify(
        {
          link: target.link_id,
          issuedBy: `${target.issuer_name} (membership ${target.issuer_membership_id})`,
          lesson: `${target.room} · ${target.subject_name}`,
          linkStatus: target.link_status,
          rosterSize: roster.length,
          pickers: pickers.map((item) => item.name),
          sessionDates: dates,
          opensToWrite: OPEN_COUNT,
        },
        null,
        2,
      ),
    );
    if (!APPLY) {
      console.log('\nDry run. Pass --apply to write.');
      return;
    }

    // Openings first, so the list reads as people picking the link up over the
    // days the lesson was covered — a few minutes before each register, and a
    // couple of times by someone who looked and left without taking one.
    for (let index = 0; index < OPEN_COUNT; index += 1) {
      const picker = pickers[index % pickers.length];
      const day = dates[index % dates.length];
      const minute = 20 + ((index * 7) % 35);
      await dataSource.query(
        `INSERT INTO audit_log (
           actor_user_id, actor_label, action, target_type, target_id,
           metadata, ip, created_at
         ) VALUES (NULL, $1, 'CLASSROOM_ATTENDANCE_LINK_OPEN',
           'classroom_attendance_links', $2, $3::jsonb, NULL, $4)`,
        [
          picker.name,
          target.link_id,
          JSON.stringify({
            schoolId: target.school_id,
            teacherName: picker.name,
            teacherMembershipId: picker.membership_id,
            authMethod: index % 3 === 0 ? 'THAID' : 'GOOGLE',
          }),
          new Date(`${day}T07:${String(minute).padStart(2, '0')}:00+07:00`).toISOString(),
        ],
      );
    }

    // Then the registers, each through the service the screen itself calls.
    let written = 0;
    for (const [index, date] of dates.entries()) {
      const picker = pickers[index % pickers.length];
      const actor = {
        source: 'CLASSROOM_LINK',
        schoolId: Number(target.school_id),
        classroomId: Number(target.classroom_id),
        actorUserId: null,
        teacherMembershipId: picker.membership_id,
        actorLabel: picker.name,
        classroomAttendanceLinkId: target.link_id,
        allowedClassroomSubjectIds: [Number(target.offering_id)],
      };
      const started = await attendance.start(actor, {
        date,
        classroomSubjectId: Number(target.offering_id),
      });
      const sessionId = started.data.id;
      // A handful of exceptions each day, rotating through the roster so the
      // same child is not absent every single lesson.
      const absentees = roster
        .slice(index % roster.length, (index % roster.length) + (index % 4))
        .map((student, offset) => ({
          studentId: student.student_uuid,
          status: ['P_ABSENT', 'P_LATE', 'P_LEAVE'][(index + offset) % 3],
          markedAt: new Date(`${date}T08:30:00+07:00`).toISOString(),
        }));
      await attendance.submit(actor, sessionId, { exceptions: absentees });
      // The two moments a register has, moved onto the day it was taken. The
      // service stamps `now()`, which would put a term of lessons in one
      // minute of this afternoon.
      await dataSource.query(
        `UPDATE attendance_sessions
         SET checking_started_at = $2, submitted_at = $3
         WHERE id = $1`,
        [
          sessionId,
          new Date(`${date}T08:25:00+07:00`).toISOString(),
          new Date(`${date}T08:41:00+07:00`).toISOString(),
        ],
      );
      written += 1;
    }

    console.log(
      `\nWrote ${OPEN_COUNT} openings and ${written} submitted registers onto link ${target.link_id}.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

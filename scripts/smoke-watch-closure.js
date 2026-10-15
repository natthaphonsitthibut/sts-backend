/**
 * ปิดการเฝ้าระวัง on the real schema (owner, 2026-10-15): a เฝ้าระวัง student is
 * decided by closing the watch (back to ปกติ, no case) or by opening a case.
 * Closing resets the teacher-comment count, a new comment brings the student
 * back, an undecided comment from an earlier term is still listed (first, and
 * marked) instead of disappearing at term change, and closing is refused while
 * a case follows the student.
 *
 * Fixtures: teacher comments, one earlier-term enrollment (with its term and
 * classroom when missing), one case and the closures — all removed at the end.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { RiskProfileRepository } = require('../dist/risk-profile/risk-profile.repository');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run watch closure smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const THRESHOLDS = { highAbsentDays: 3 };
const AUTHOR = 'Automated watch closure smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStatus(promise, status, label) {
  try {
    await promise;
  } catch (error) {
    const actual = typeof error.getStatus === 'function' ? error.getStatus() : null;
    assert(actual === status, `${label}: expected ${status}, got ${actual} (${error.message})`);
    return;
  }
  throw new Error(`${label}: expected ${status}, but the call succeeded`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const caseService = app.get(CaseService);
  const taskRepository = app.get(TaskRepository);
  const riskProfiles = app.get(RiskProfileRepository);

  const created = { comments: [], priorUuid: null, termId: null, classroomId: null, caseId: null };
  let current = null;

  const tier = async () => {
    await riskProfiles.recalculateStudents([current.student_uuid], THRESHOLDS);
    const [row] = await dataSource.query(
      `SELECT risk_tier FROM student_risk_profiles WHERE student_uuid = $1`,
      [current.student_uuid],
    );
    return row?.risk_tier;
  };
  const comment = async (classroomId, createdAt = null) => {
    const [row] = await dataSource.query(
      `INSERT INTO classroom_student_comments (
         classroom_id, person_uuid, problem_description, problem_category_code,
         concern_level_code, authored_by_display_name, created_at
       ) VALUES ($1, $2, 'ควรเฝ้าดูการมาเรียน', 'HEALTH', 'WATCH', $3, COALESCE($4::timestamptz, now()))
       RETURNING id`,
      [classroomId, current.person_uuid, AUTHOR, createdAt],
    );
    created.comments.push(row.id);
  };

  try {
    [current] = await dataSource.query(
      `SELECT s.*, CONCAT_WS(' ', s."FirstName_Onec", s."LastName_Onec") AS student_name
       FROM student_term s
       JOIN student_current_enrollment_resolution resolution
         ON resolution.person_uuid = s.person_uuid
        AND resolution.selected_student_uuid = s.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
       WHERE s.deleted_at IS NULL AND s.classroom_id IS NOT NULL
         AND COALESCE(profile.absent_days_since_case_reset, 0) < $1
         AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.person_uuid = s.person_uuid)
         AND NOT EXISTS (
           SELECT 1 FROM classroom_student_comments c WHERE c.person_uuid = s.person_uuid
         )
         AND NOT EXISTS (
           SELECT 1 FROM student_term other
           WHERE other.person_uuid = s.person_uuid AND other.student_uuid <> s.student_uuid
         )
       ORDER BY s.student_uuid
       LIMIT 1`,
      [THRESHOLDS.highAbsentDays],
    );
    assert(current, 'need an active student with no case, comment or other enrollment');
    const schoolId = Number(current.SchoolID_Onec);
    const [user] = await dataSource.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
    const actor = {
      id: Number(user.id),
      username: 'watch-closure-smoke',
      roles: ['DIRECTOR'],
      permissions: ['dashboard', 'case:manage'],
      data_scope: { school_ids: [schoolId] },
    };
    const watchlist = async () =>
      (
        await taskRepository.listRiskDashboardStudents(
          actor,
          {
            studentGroup: 'WATCHLIST',
            schoolId,
            academicYear: Number(current.AcademicYear_Onec),
            semester: Number(current.Semester_Onec),
            searchTerm: current.student_name,
            limit: 50,
          },
          THRESHOLDS,
        )
      ).rows.find((row) => row.student_uuid === current.student_uuid);

    await comment(current.classroom_id);
    assert((await tier()) === 'WATCH', 'a new comment does not make the student WATCH');
    const listed = await watchlist();
    assert(listed && Number(listed.pending_comment_count) === 1, 'the commented student is not listed');
    assert(!listed.pending_from_previous_term, 'a this-term comment is marked as from an earlier term');
    console.log('ok a teacher comment puts the student on the watchlist as WATCH');

    const closed = await caseService.closeWatch({ student_id: current.student_uuid }, actor);
    assert(closed.success && closed.data.id, 'closing the watch returned no closure');
    assert((await tier()) === 'NORMAL', 'a closed watch still leaves the student WATCH');
    assert(!(await watchlist()), 'a closed watch is still on the watchlist');
    await expectStatus(
      caseService.closeWatch({ student_id: current.student_uuid, note: 'ซ้ำ' }, actor),
      409,
      'closing with nothing waiting',
    );
    console.log('ok closing the watch (no note) returns the student to NORMAL and off the list; a second close is refused');

    await comment(current.classroom_id);
    assert((await tier()) === 'WATCH', 'a comment after the close does not bring WATCH back');
    const back = await watchlist();
    assert(back && Number(back.pending_comment_count) === 1, 'only the comment after the close should be waiting');
    assert(back.last_watch_closed_at, 'the row does not say when the watch was closed');
    await caseService.closeWatch({ student_id: current.student_uuid, note: 'ครูยืนยันแล้ว' }, actor);
    const [{ note }] = await dataSource.query(
      `SELECT note FROM student_watch_closures WHERE student_uuid = $1 ORDER BY id DESC LIMIT 1`,
      [current.student_uuid],
    );
    assert(note === 'ครูยืนยันแล้ว', 'the closure note was not kept');
    console.log('ok a comment after the close brings the student back; a note is kept when given');

    // An undecided comment from an earlier term.
    const priorYear = Number(current.AcademicYear_Onec) - 1;
    const [existingTerm] = await dataSource.query(
      `SELECT id FROM school_terms WHERE school_id = $1 AND academic_year = $2 AND semester = 2`,
      [schoolId, priorYear],
    );
    let termId = existingTerm ? Number(existingTerm.id) : null;
    if (!termId) {
      const [term] = await dataSource.query(
        `INSERT INTO school_terms (school_id, academic_year, semester, starts_on, ends_on, status)
         VALUES ($1, $2, 2, make_date($3, 11, 1), make_date($3 + 1, 3, 31), 'CLOSED') RETURNING id`,
        [schoolId, priorYear, priorYear - 543],
      );
      termId = created.termId = Number(term.id);
    }
    const [existingRoom] = await dataSource.query(
      `SELECT id FROM school_classrooms WHERE school_term_id = $1 AND grade_level_id = $2
         AND legacy_room_number = $3 AND classroom_status = 'ACTIVE' AND deleted_at IS NULL`,
      [termId, current.GradeLevelID_Onec, current.RoomID_Onec],
    );
    let priorClassroomId = existingRoom ? Number(existingRoom.id) : null;
    if (!priorClassroomId) {
      const [room] = await dataSource.query(
        `INSERT INTO school_classrooms (school_term_id, school_id, grade_level_id, legacy_room_number, room_code)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [termId, schoolId, current.GradeLevelID_Onec, current.RoomID_Onec, String(current.RoomID_Onec)],
      );
      priorClassroomId = created.classroomId = Number(room.id);
    }
    const [prior] = await dataSource.query(
      `INSERT INTO student_term (
         "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec", "PersonID_Onec", person_uuid,
         "FirstName_Onec", "LastName_Onec", "GradeLevelID_Onec", "RoomID_Onec"
       ) VALUES ($1, 2, $2, $3, $4, $5, $6, $7, $8) RETURNING student_uuid`,
      [
        priorYear,
        schoolId,
        current.PersonID_Onec,
        current.person_uuid,
        current.FirstName_Onec,
        current.LastName_Onec,
        current.GradeLevelID_Onec,
        current.RoomID_Onec,
      ],
    );
    created.priorUuid = prior.student_uuid;
    await comment(priorClassroomId);
    const carried = await watchlist();
    assert(carried, 'an undecided earlier-term comment dropped off the current watchlist');
    assert(carried.pending_from_previous_term === true, 'the carried row is not marked ค้างจากเทอมก่อน');
    assert((await tier()) === 'WATCH', 'an undecided earlier-term comment no longer counts as WATCH');
    const firstPage = await taskRepository.listRiskDashboardStudents(
      actor,
      {
        studentGroup: 'WATCHLIST',
        schoolId,
        academicYear: Number(current.AcademicYear_Onec),
        semester: Number(current.Semester_Onec),
        limit: 10,
      },
      THRESHOLDS,
    );
    assert(
      firstPage.rows[0]?.pending_from_previous_term === true,
      'carried rows are not listed first',
    );
    console.log('ok an undecided earlier-term comment stays listed, marked and first, until decided');

    const [opened] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, reason_flagged, status)
       VALUES ($1, $2, $3, $4, 'OPEN') RETURNING id`,
      [current.student_uuid, current.student_name, schoolId, AUTHOR],
    );
    created.caseId = Number(opened.id);
    await expectStatus(
      caseService.closeWatch({ student_id: current.student_uuid }, actor),
      409,
      'closing while a case follows the student',
    );
    const followed = await watchlist();
    assert(followed && !followed.pending_from_previous_term, 'a followed student is still marked undecided');
    console.log('ok while a case follows the student, the watch cannot be closed and is no longer undecided');

    console.log('Watch closure smoke passed');
  } finally {
    if (current) {
      await dataSource.query(
        `DELETE FROM student_watch_closures
         WHERE student_uuid IN (SELECT student_uuid FROM student_term WHERE person_uuid = $1)`,
        [current.person_uuid],
      );
    }
    if (created.caseId !== null) {
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [created.caseId]);
    }
    if (created.comments.length > 0) {
      await dataSource.query(`DELETE FROM classroom_student_comments WHERE id = ANY($1::bigint[])`, [
        created.comments,
      ]);
    }
    if (created.priorUuid !== null) {
      await dataSource.query(`DELETE FROM student_risk_profiles WHERE student_uuid = $1`, [
        created.priorUuid,
      ]);
      await dataSource.query(`DELETE FROM student_term WHERE student_uuid = $1`, [created.priorUuid]);
    }
    if (created.classroomId !== null) {
      await dataSource.query(`DELETE FROM school_classrooms WHERE id = $1`, [created.classroomId]);
    }
    if (created.termId !== null) {
      await dataSource.query(`DELETE FROM school_terms WHERE id = $1`, [created.termId]);
    }
    if (current) {
      await riskProfiles.recalculateStudents([current.student_uuid], THRESHOLDS);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

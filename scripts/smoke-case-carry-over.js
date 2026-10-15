/**
 * A case follows the student across terms (owner, 2026-10-15): an open case
 * opened in an earlier enrollment keeps the student เสี่ยง in the current term,
 * shows on the current term's กลุ่มเสี่ยง list, and blocks a second active case;
 * once closed, it no longer carries.
 *
 * Fixture: one earlier-term enrollment (2 terms back from the student's current
 * one) for a real active student, holding one case. Both are removed at the end.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { RiskProfileRepository } = require('../dist/risk-profile/risk-profile.repository');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run case carry-over smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const REASON = 'Automated case carry-over smoke';
const THRESHOLDS = { highAbsentDays: 3 };
const ACTIVE = `('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND', 'AWAITING_REFERRAL',
  'AWAITING_REFERRAL_OUTCOME', 'REFERRAL_NOT_SUCCEEDED')`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

  let priorUuid = null;
  let priorTermId = null;
  let priorClassroomId = null;
  let caseId = null;
  let currentUuid = null;

  const profile = async () => {
    await riskProfiles.recalculateStudents([currentUuid], THRESHOLDS);
    const [row] = await dataSource.query(
      `SELECT risk_tier, open_case_count, latest_open_case_id, absent_days_since_case_reset
       FROM student_risk_profiles WHERE student_uuid = $1`,
      [currentUuid],
    );
    return row;
  };

  try {
    const [current] = await dataSource.query(
      `SELECT s.*, CONCAT_WS(' ', s."FirstName_Onec", s."LastName_Onec") AS student_name
       FROM student_term s
       JOIN student_current_enrollment_resolution resolution
         ON resolution.person_uuid = s.person_uuid
        AND resolution.selected_student_uuid = s.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
       WHERE s.deleted_at IS NULL
         AND COALESCE(profile.absent_days_since_case_reset, 0) < $1
         AND NOT EXISTS (
           SELECT 1 FROM cases c
           WHERE c.person_uuid = s.person_uuid AND c.deleted_at IS NULL
         )
       ORDER BY s.student_uuid
       LIMIT 1`,
      [THRESHOLDS.highAbsentDays],
    );
    assert(current, 'need an active student with no case and few absences');
    currentUuid = current.student_uuid;
    const priorYear = Number(current.AcademicYear_Onec) - 1;
    const [existingTerm] = await dataSource.query(
      `SELECT id FROM school_terms WHERE school_id = $1 AND academic_year = $2 AND semester = 2`,
      [current.SchoolID_Onec, priorYear],
    );
    if (!existingTerm) {
      const [term] = await dataSource.query(
        `INSERT INTO school_terms (school_id, academic_year, semester, starts_on, ends_on, status)
         VALUES ($1, $2, 2, make_date($3, 11, 1), make_date($3 + 1, 3, 31), 'CLOSED')
         RETURNING id`,
        [current.SchoolID_Onec, priorYear, priorYear - 543],
      );
      priorTermId = Number(term.id);
    }
    const termId = priorTermId ?? Number(existingTerm.id);
    const [existingRoom] = await dataSource.query(
      `SELECT id FROM school_classrooms
       WHERE school_term_id = $1 AND grade_level_id = $2 AND legacy_room_number = $3
         AND classroom_status = 'ACTIVE' AND deleted_at IS NULL`,
      [termId, current.GradeLevelID_Onec, current.RoomID_Onec],
    );
    if (!existingRoom) {
      const [room] = await dataSource.query(
        `INSERT INTO school_classrooms (school_term_id, school_id, grade_level_id, legacy_room_number, room_code)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [termId, current.SchoolID_Onec, current.GradeLevelID_Onec, current.RoomID_Onec, String(current.RoomID_Onec)],
      );
      priorClassroomId = Number(room.id);
    }

    const [prior] = await dataSource.query(
      `INSERT INTO student_term (
         "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec", "PersonID_Onec", person_uuid,
         "FirstName_Onec", "LastName_Onec", "GradeLevelID_Onec", "RoomID_Onec"
       ) VALUES ($1, 2, $2, $3, $4, $5, $6, $7, $8)
       RETURNING student_uuid`,
      [
        priorYear,
        current.SchoolID_Onec,
        current.PersonID_Onec,
        current.person_uuid,
        current.FirstName_Onec,
        current.LastName_Onec,
        current.GradeLevelID_Onec,
        current.RoomID_Onec,
      ],
    );
    priorUuid = prior.student_uuid;

    const [opened] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, reason_flagged, status)
       VALUES ($1, $2, $3, $4, 'OPEN')
       RETURNING id, person_uuid`,
      [priorUuid, current.student_name, current.SchoolID_Onec, REASON],
    );
    caseId = Number(opened.id);
    assert(
      opened.person_uuid === current.person_uuid,
      'trigger did not fill the case person from its enrollment',
    );
    console.log('ok a case opened on an earlier enrollment takes that student as its person');

    const carried = await profile();
    assert(carried?.risk_tier === 'HIGH', `expected HIGH from the carried case, got ${carried?.risk_tier}`);
    assert(Number(carried.open_case_count) === 1, 'carried case is not counted as open');
    assert(Number(carried.latest_open_case_id) === caseId, 'profile points at another case');
    console.log('ok an open case from an earlier term keeps the current enrollment เสี่ยง');

    const actor = {
      id: 0,
      username: 'case-carry-over-smoke',
      roles: ['ADMIN'],
      permissions: ['dashboard', 'case:manage'],
      data_scope: { school_ids: [Number(current.SchoolID_Onec)] },
    };
    const riskList = await taskRepository.listRiskDashboardStudents(
      actor,
      {
        studentGroup: 'RISK',
        schoolId: Number(current.SchoolID_Onec),
        academicYear: Number(current.AcademicYear_Onec),
        semester: Number(current.Semester_Onec),
        searchTerm: current.student_name,
        limit: 50,
      },
      THRESHOLDS,
    );
    const listed = riskList.rows.find((row) => row.student_uuid === currentUuid);
    assert(listed, 'the current-term กลุ่มเสี่ยง list does not show the carried case');
    console.log('ok the current term กลุ่มเสี่ยง list shows the carried case');

    const reopened = await caseService.openCase(
      { student_id: currentUuid, reason: 'should reuse the carried case' },
      actor,
    );
    assert(reopened.created === false && Number(reopened.data?.id) === caseId, 'a second case was opened beside the carried one');
    const [{ active }] = await dataSource.query(
      `SELECT COUNT(*)::int AS active FROM cases
       WHERE person_uuid = $1 AND deleted_at IS NULL AND status IN ${ACTIVE}`,
      [current.person_uuid],
    );
    assert(active === 1, `expected one active case for the student, found ${active}`);
    await dataSource
      .query(
        `INSERT INTO cases (student_uuid, student_name, school_id, reason_flagged, status)
         VALUES ($1, $2, $3, $4, 'OPEN')`,
        [currentUuid, current.student_name, current.SchoolID_Onec, REASON],
      )
      .then(
        () => {
          throw new Error('the database allowed a second active case in the new term');
        },
        (error) =>
          assert(
            /uq_cases_active_person_uuid/.test(error.message),
            `unexpected insert error: ${error.message}`,
          ),
      );
    console.log('ok opening a case in the new term reuses the carried one; the database refuses a second');

    await dataSource.query(
      `UPDATE cases SET status = 'RESOLVED', completion_outcome_code = 'CLOSED' WHERE id = $1`,
      [caseId],
    );
    const closed = await profile();
    assert(closed?.risk_tier !== 'HIGH', `a closed case still keeps the student HIGH (${closed?.risk_tier})`);
    assert(Number(closed.open_case_count) === 0, 'a closed case is still counted as open');
    const afterClose = await taskRepository.listRiskDashboardStudents(
      actor,
      {
        studentGroup: 'RISK',
        schoolId: Number(current.SchoolID_Onec),
        academicYear: Number(current.AcademicYear_Onec),
        semester: Number(current.Semester_Onec),
        searchTerm: current.student_name,
        limit: 50,
      },
      THRESHOLDS,
    );
    assert(
      !afterClose.rows.some((row) => row.student_uuid === currentUuid),
      'a case closed in an earlier term still shows on the current term list',
    );
    console.log('ok once closed, the earlier-term case no longer carries');

    console.log('Case carry-over smoke passed');
  } finally {
    if (caseId !== null) {
      await dataSource.query(`DELETE FROM case_status_history WHERE case_id = $1`, [caseId]).catch(() => {});
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [caseId]);
    }
    if (priorUuid !== null) {
      await dataSource.query(`DELETE FROM student_risk_profiles WHERE student_uuid = $1`, [priorUuid]);
      await dataSource.query(`DELETE FROM student_term WHERE student_uuid = $1`, [priorUuid]);
    }
    if (priorClassroomId !== null) {
      await dataSource.query(`DELETE FROM school_classrooms WHERE id = $1`, [priorClassroomId]);
    }
    if (priorTermId !== null) {
      await dataSource.query(`DELETE FROM school_terms WHERE id = $1`, [priorTermId]);
    }
    if (currentUuid !== null) {
      await riskProfiles.recalculateStudents([currentUuid], THRESHOLDS);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

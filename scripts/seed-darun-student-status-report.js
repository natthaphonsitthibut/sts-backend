const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { generateToken, hashToken } = require('../dist/common/utils/helpers');
const { TokenEncryptionService } = require('../dist/common/crypto/token-encryption.service');

const SCHOOL_NAME = 'โรงเรียนดรุณศึกษาธิการ';
const ABSENCE_REASON = 'ขาดเรียนสะสม';
const ABSENCE_DAY_COUNT = 3;
const ATTENDANCE_SEED_MARKER = 'SYSTEM:DARUN_STUDENT_STATUS_REPORT';

async function listCompletedTermWeekdays(manager, schoolId) {
  const rows = await manager.query(
    `SELECT day_value::date::text AS date
     FROM school_terms term
     CROSS JOIN LATERAL generate_series(
       term.starts_on,
       LEAST(term.ends_on, (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 1),
       INTERVAL '1 day'
     ) AS day_value
     WHERE term.school_id = $1
       AND term.status = 'ACTIVE'
       AND term.deleted_at IS NULL
       AND EXTRACT(ISODOW FROM day_value) BETWEEN 1 AND 5
     ORDER BY day_value`,
    [schoolId],
  );
  if (!rows.length) {
    throw new Error('ไม่พบวันเรียนย้อนหลังในภาคเรียนที่เปิดใช้งานของโรงเรียนดรุณศึกษาธิการ');
  }
  return rows.map((row) => row.date);
}

async function seedSchoolAttendanceHistory(
  manager,
  schoolId,
  historyDates,
  absenceDates,
  absentStudentUuids,
  actorUserId,
) {
  await manager.query(
    `WITH active_term AS (
       SELECT id FROM school_terms WHERE school_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
     )
     INSERT INTO school_calendar_days (school_term_id, calendar_date, day_type, source, created_by, updated_by)
     SELECT term.id, day_value::date, 'SCHOOL_DAY', 'MANUAL', $3, $3
     FROM active_term term CROSS JOIN unnest($2::date[]) AS day_value
     ON CONFLICT (school_term_id, calendar_date) DO NOTHING`,
    [schoolId, historyDates, actorUserId],
  );

  await manager.query(`DROP TABLE IF EXISTS darun_seed_session_ids`);
  await manager.query(
    `CREATE TEMP TABLE darun_seed_session_ids ON COMMIT DROP AS
     WITH roster AS (
       SELECT s.school_term_id, s."SchoolID_Onec" AS school_id,
         s."GradeLevelID_Onec" AS grade_level_id, s."RoomID_Onec"::int AS room_id,
         COUNT(*)::int AS roster_count
       FROM student_term s
       JOIN student_current_enrollment_resolution current_enrollment
         ON current_enrollment.person_uuid = s.person_uuid
        AND current_enrollment.selected_student_uuid = s.student_uuid
        AND current_enrollment.resolution_state = 'ACTIVE'
       WHERE s."SchoolID_Onec" = $1 AND s.deleted_at IS NULL
       GROUP BY 1, 2, 3, 4
     ), slots AS (
       SELECT slot.id, slot.school_term_id, slot.school_id, slot.grade_level_id,
         slot.room_no::int AS room_id, slot.period, slot.subject_id,
         slot.teacher_membership_id, slot.day_of_week
       FROM timetable_slots slot
       WHERE slot.school_id = $1
         AND slot.deleted_at IS NULL
         AND slot.teacher_membership_id IS NOT NULL
     ), inserted_sessions AS (
     INSERT INTO attendance_sessions (
       school_term_id, school_id, grade_level_id, room_id, attendance_date,
       period, session_kind, subject_id, timetable_slot_id, status,
       expected_roster_count, recorded_count, submitted_at, submitted_by,
       created_by, updated_by
     )
     SELECT slot.school_term_id, slot.school_id, slot.grade_level_id, slot.room_id,
       day_value::date, slot.period, 'SUBJECT', slot.subject_id, slot.id,
       'SUBMITTED', roster.roster_count, roster.roster_count,
       day_value::date + TIME '15:00', $3,
       $3, $3
     FROM slots slot
     JOIN roster ON roster.school_term_id = slot.school_term_id
       AND roster.grade_level_id = slot.grade_level_id AND roster.room_id = slot.room_id
     CROSS JOIN unnest($2::date[]) AS day_value
     JOIN school_calendar_days calendar_day
       ON calendar_day.school_term_id = slot.school_term_id
      AND calendar_day.calendar_date = day_value::date
      AND calendar_day.day_type = 'SCHOOL_DAY'
      AND calendar_day.deleted_at IS NULL
     WHERE EXTRACT(ISODOW FROM day_value) = slot.day_of_week
     ON CONFLICT (school_term_id, grade_level_id, room_id, attendance_date, period, session_kind)
     DO NOTHING
     RETURNING id
     )
     SELECT id FROM inserted_sessions
     UNION
     SELECT session.id
     FROM attendance_sessions session
     WHERE session.school_id = $1
       AND session.session_kind = 'SUBJECT'
       AND session.attendance_date = ANY($2::date[])
       AND session.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM attendance seeded
         WHERE seeded.session_id = session.id AND seeded."RecordedBy" = $4
       )
       AND NOT EXISTS (
         SELECT 1 FROM attendance actual
         WHERE actual.session_id = session.id AND actual."RecordedBy" <> $4
       )`,
    [schoolId, historyDates, actorUserId, ATTENDANCE_SEED_MARKER],
  );

  await manager.query(
    `WITH roster AS (
       SELECT s.student_uuid, s."SchoolID_Onec" AS school_id,
         s."GradeLevelID_Onec" AS grade_level_id, s."RoomID_Onec"::int AS room_id,
         s."AcademicYear_Onec" AS academic_year, s."Semester_Onec" AS semester
       FROM student_term s
       JOIN student_current_enrollment_resolution current_enrollment
         ON current_enrollment.person_uuid = s.person_uuid
        AND current_enrollment.selected_student_uuid = s.student_uuid
        AND current_enrollment.resolution_state = 'ACTIVE'
       WHERE s."SchoolID_Onec" = $1 AND s.deleted_at IS NULL
     )
     INSERT INTO attendance (
       student_uuid, "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
       "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period",
       session_kind, "AttendanceStatus", "RecordedAt", "RecordedBy", session_id,
       created_by, updated_by
     )
     SELECT roster.student_uuid, roster.school_id, roster.grade_level_id, roster.room_id,
       roster.academic_year, roster.semester, session.attendance_date, session.period,
       'SUBJECT',
       CASE WHEN roster.student_uuid = ANY($3::uuid[])
             AND session.attendance_date = ANY($4::date[]) THEN 2 ELSE 1 END,
       session.attendance_date + TIME '15:00', $5, session.id,
       session.submitted_by, session.submitted_by
     FROM roster
     JOIN attendance_sessions session ON session.school_id = roster.school_id
       AND session.grade_level_id = roster.grade_level_id AND session.room_id = roster.room_id
       AND session.session_kind = 'SUBJECT' AND session.attendance_date = ANY($2::date[])
       AND session.deleted_at IS NULL
     JOIN darun_seed_session_ids seeded_session ON seeded_session.id = session.id
     ON CONFLICT (student_uuid, "AttendanceDate", "Period") WHERE session_kind = 'SUBJECT'
     DO UPDATE SET "AttendanceStatus" = EXCLUDED."AttendanceStatus",
       session_id = EXCLUDED.session_id, "RecordedAt" = EXCLUDED."RecordedAt",
       "RecordedBy" = EXCLUDED."RecordedBy", updated_by = EXCLUDED.updated_by
     WHERE attendance."RecordedBy" = $5`,
    [schoolId, historyDates, absentStudentUuids, absenceDates, ATTENDANCE_SEED_MARKER],
  );
}

async function repairTimetableTeacherCoverage(manager, schoolId, actorUserId) {
  const [invalidCoverage] = await manager.query(
    `SELECT COUNT(*)::int AS invalid_count
     FROM timetable_slots slot
     LEFT JOIN school_teacher_memberships membership
       ON membership.id = slot.teacher_membership_id
      AND membership.school_id = slot.school_id
      AND membership.membership_status = 'ACTIVE'
      AND membership.deleted_at IS NULL
     LEFT JOIN teachers teacher
       ON teacher.id = membership.teacher_id
      AND teacher.teacher_status = 'ACTIVE'
      AND teacher.deleted_at IS NULL
     WHERE slot.school_id = $1
       AND slot.deleted_at IS NULL
       AND (slot.teacher_membership_id IS NULL OR membership.id IS NULL OR teacher.id IS NULL)`,
    [schoolId],
  );
  if (Number(invalidCoverage.invalid_count) > 0) {
    throw new Error(
      `พบ timetable ${invalidCoverage.invalid_count} คาบที่ไม่มีครู active; หยุดเพื่อไม่เขียนทับ master data`,
    );
  }

  const [teacherConflicts] = await manager.query(
    `SELECT COUNT(*)::int AS conflict_count
     FROM (
       SELECT slot.teacher_membership_id, slot.day_of_week, slot.period
       FROM timetable_slots slot
       WHERE slot.school_id = $1 AND slot.deleted_at IS NULL
       GROUP BY slot.teacher_membership_id, slot.day_of_week, slot.period
       HAVING COUNT(*) > 1
     ) conflict`,
    [schoolId],
  );
  if (Number(teacherConflicts.conflict_count) > 0) {
    throw new Error(
      `พบครูซ้อนคาบ ${teacherConflicts.conflict_count} ช่วงเวลา; หยุดเพื่อไม่เขียนทับ master data`,
    );
  }

  await manager.query(
    `INSERT INTO curriculum_subject_teachers (
       curriculum_subject_id, school_id, school_term_id, grade_level_id,
       teacher_membership_id, classroom_id, created_by, updated_by
     )
       SELECT DISTINCT curriculum_subject.id, slot.school_id, slot.school_term_id,
       slot.grade_level_id, slot.teacher_membership_id, slot.classroom_id,
       $2, $2
     FROM timetable_slots slot
     JOIN curriculum_subjects curriculum_subject
       ON curriculum_subject.school_id = slot.school_id
      AND curriculum_subject.school_term_id = slot.school_term_id
      AND curriculum_subject.grade_level_id = slot.grade_level_id
      AND curriculum_subject.subject_id = slot.subject_id
      AND curriculum_subject.deleted_at IS NULL
     WHERE slot.school_id = $1
       AND slot.teacher_membership_id IS NOT NULL
       AND slot.classroom_id IS NOT NULL
       AND slot.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM curriculum_subject_teachers existing
         WHERE existing.curriculum_subject_id = curriculum_subject.id
           AND existing.teacher_membership_id = slot.teacher_membership_id
           AND existing.classroom_id = slot.classroom_id
           AND existing.deleted_at IS NULL
       )`,
    [schoolId, actorUserId],
  );
}

const CASE_SCENARIOS = [
  { status: 'OPEN', taskStatus: null, linkStatus: null, completionOutcome: null, teacherComment: 'นักเรียนขาดเรียนต่อเนื่องและควรมอบหมายผู้ติดตาม', caseSummary: 'นักเรียนขาดเรียนต่อเนื่องและควรมอบหมายผู้ติดตาม' },
  { status: 'OPEN', taskStatus: null, linkStatus: null, completionOutcome: null, teacherComment: 'นักเรียนมาเรียนไม่สม่ำเสมอ ควรประสานผู้ปกครอง', caseSummary: 'นักเรียนมาเรียนไม่สม่ำเสมอ ควรประสานผู้ปกครอง' },
  { status: 'OPEN', taskStatus: null, linkStatus: null, completionOutcome: null, teacherComment: 'นักเรียนมีพฤติกรรมถอนตัวจากกิจกรรมในชั้นเรียน', caseSummary: 'นักเรียนมีพฤติกรรมถอนตัวจากกิจกรรมในชั้นเรียน' },
  { status: 'IN_PROGRESS', taskStatus: 'IN_PROGRESS', linkStatus: 'ACTIVE', completionOutcome: null, teacherComment: 'นักเรียนขาดเรียนต่อเนื่องและผู้ปกครองแจ้งว่ามีข้อจำกัดด้านการเดินทาง', caseSummary: 'อยู่ระหว่างติดตามการมาเรียนและนัดหมายผู้ปกครอง' },
  { status: 'IN_PROGRESS', taskStatus: 'IN_PROGRESS', linkStatus: 'ACTIVE', linkExpired: true, completionOutcome: null, teacherComment: 'นักเรียนมาเรียนสายและขาดเรียนเป็นบางวัน ควรประสานผู้ปกครองเรื่องการเดินทาง', caseSummary: 'ครูผู้รับมอบหมายกำลังประสานการเดินทางมาโรงเรียนกับครอบครัว' },
  { status: 'PENDING_REVIEW', taskStatus: 'PENDING_REVIEW', linkStatus: 'COMPLETED', completionOutcome: null, teacherComment: 'นักเรียนขาดเรียนเป็นระยะและส่งงานไม่ครบ ควรหาแนวทางช่วยเหลือร่วมกับผู้ปกครอง', caseSummary: 'ผู้ติดตามส่งรายงานครบถ้วน รอผู้รับผิดชอบพิจารณาแนวทางต่อไป' },
  { status: 'PENDING_REVIEW', taskStatus: 'PENDING_REVIEW', linkStatus: 'COMPLETED', completionOutcome: null, teacherComment: 'นักเรียนมีความกังวลเรื่องการเรียนและต้องการคำแนะนำเพิ่มเติม', caseSummary: 'ติดตามผู้ปกครองแล้ว รอพิจารณาแผนช่วยเหลือรายบุคคล' },
  { status: 'STUDENT_NOT_FOUND', taskStatus: 'COMPLETED', linkStatus: 'COMPLETED', completionOutcome: null, teacherComment: 'นักเรียนขาดเรียนต่อเนื่องและติดต่อผู้ปกครองไม่ได้', caseSummary: 'ลงพื้นที่ตามข้อมูลที่มีแล้วไม่พบนักเรียนและติดต่อผู้ปกครองไม่ได้' },
  { status: 'RESOLVED', taskStatus: 'COMPLETED', linkStatus: 'COMPLETED', completionOutcome: 'CLOSED', teacherComment: 'นักเรียนขาดเรียนต่อเนื่อง ควรติดตามความพร้อมในการกลับมาเรียน', caseSummary: 'ติดตามครบถ้วน นักเรียนกลับมาเรียนต่อเนื่องและปิดเคส' },
  { status: 'RESOLVED', taskStatus: 'COMPLETED', linkStatus: 'COMPLETED', completionOutcome: 'REFERRED_AGENCY', teacherComment: 'นักเรียนมีปัญหาครอบครัวและต้องการความช่วยเหลือจากหน่วยงานที่เกี่ยวข้อง', caseSummary: 'ติดตามครบถ้วนและส่งต่อหน่วยงานที่เกี่ยวข้องเพื่อดูแลต่อ' },
];

const WATCH_COMMENTS = [
  'นักเรียนเริ่มมาเรียนสายบ่อยครั้ง ควรติดตามการเดินทางมาโรงเรียน',
  'นักเรียนเงียบผิดปกติในชั้นเรียนและไม่ร่วมกิจกรรมกลุ่ม',
  'นักเรียนส่งงานไม่ครบต่อเนื่อง ควรพูดคุยกับผู้ปกครอง',
  'นักเรียนขาดเรียนเป็นบางวันโดยไม่มีใบลา ขอให้เฝ้าติดตาม',
  'นักเรียนมีความกังวลเรื่องการเรียน ควรติดตามความเป็นอยู่',
  'นักเรียนเปลี่ยนพฤติกรรมหลังพักกลางวัน ควรสังเกตต่อเนื่อง',
  'นักเรียนต้องการความช่วยเหลือเรื่องอุปกรณ์การเรียน',
  'นักเรียนมีการแยกตัวจากเพื่อนในห้องเรียนบ่อยครั้ง',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const tokenEncryption = app.get(TokenEncryptionService);
  try {
    const result = await dataSource.transaction(async (manager) => {
      const [school] = await manager.query(
        `SELECT id, name FROM schools WHERE name = $1 LIMIT 1`,
        [SCHOOL_NAME],
      );
      if (!school) throw new Error(`ไม่พบ ${SCHOOL_NAME}`);

      // โรงเรียนนี้ไม่มี user บทบาท DIRECTOR/ADMIN_SCHOOL ในระบบ; เคสที่ปิดแล้วจึง
      // ใช้ ADMIN กลางที่มี review-cases/close-case จริงเป็นผู้พิจารณาแทนครูประจำชั้น
      // (ครูไม่มีสิทธิ์นี้ตาม permission baseline จริง)
      const [reviewerAdmin] = await manager.query(
        `SELECT id, COALESCE(NULLIF(TRIM("FirstName" || ' ' || "LastName"), ''), username) AS display_name
         FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id LIMIT 1`,
      );
      if (!reviewerAdmin) throw new Error('ไม่พบ ADMIN ที่ active สำหรับใช้เป็นผู้พิจารณาเคส');

      await repairTimetableTeacherCoverage(manager, school.id);
      const historyDates = await listCompletedTermWeekdays(manager, school.id);
      const absenceDates = historyDates.slice(-ABSENCE_DAY_COUNT);

      const existingCases = new Map();
      for (const scenario of CASE_SCENARIOS) {
        const [row] = await manager.query(
          `SELECT student_uuid::text AS student_uuid
           FROM cases
           WHERE school_id = $1
             AND reason_flagged LIKE $2
             AND result_summary = $3
             AND deleted_at IS NULL
           LIMIT 1`,
          [school.id, `${ABSENCE_REASON} %`, scenario.caseSummary],
        );
        if (row?.student_uuid) existingCases.set(scenario.caseSummary, row.student_uuid);
      }

      const candidates = await manager.query(
        `SELECT
           enrollment.student_uuid::text AS student_uuid,
           enrollment.person_uuid::text AS person_uuid,
           enrollment.classroom_id::bigint AS classroom_id,
           enrollment.school_term_id::bigint AS school_term_id,
           enrollment."GradeLevelID_Onec"::int AS grade_level_id,
           trim(concat_ws(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec")) AS student_name,
           grade.label AS grade,
           enrollment."RoomID_Onec"::text AS room,
           homeroom_user.id AS teacher_user_id,
           trim(concat_ws(' ', homeroom_user."FirstName", homeroom_user."LastName")) AS teacher_name,
           homeroom_user."FirstName" AS teacher_first_name,
           homeroom_user."LastName" AS teacher_last_name,
           homeroom_user.email AS teacher_email,
           homeroom_user.username AS teacher_username,
           EXISTS (
             SELECT 1 FROM cases existing_case
             WHERE existing_case.student_uuid = enrollment.student_uuid
               AND existing_case.deleted_at IS NULL
           ) AS has_active_case
         FROM student_term enrollment
         JOIN student_current_enrollment_resolution current_enrollment
           ON current_enrollment.person_uuid = enrollment.person_uuid
          AND current_enrollment.selected_student_uuid = enrollment.student_uuid
          AND current_enrollment.resolution_state = 'ACTIVE'
         JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
         JOIN classroom_teacher_assignments homeroom_assignment
           ON homeroom_assignment.classroom_id = enrollment.classroom_id
          AND homeroom_assignment.school_id = enrollment."SchoolID_Onec"
          AND homeroom_assignment.assignment_kind = 'HOMEROOM'
          AND homeroom_assignment.assignment_status = 'ACTIVE'
          AND homeroom_assignment.deleted_at IS NULL
         JOIN school_teacher_memberships homeroom_membership
           ON homeroom_membership.id = homeroom_assignment.teacher_membership_id
          AND homeroom_membership.school_id = enrollment."SchoolID_Onec"
          AND homeroom_membership.membership_status = 'ACTIVE'
          AND homeroom_membership.deleted_at IS NULL
         JOIN users homeroom_user
           ON homeroom_user.id = homeroom_membership.teacher_user_id
          AND homeroom_user.status = 'ACTIVE'
         WHERE enrollment."SchoolID_Onec" = $1
           AND enrollment.deleted_at IS NULL
         ORDER BY grade.id, enrollment."RoomID_Onec", enrollment.student_uuid
         FOR UPDATE OF enrollment`,
        [school.id],
      );

      const requiredNewCases = CASE_SCENARIOS.filter(
        (scenario) => !existingCases.has(scenario.caseSummary),
      ).length;
      const availableCandidates = candidates.filter(
        (candidate) => !candidate.has_active_case,
      );
      const requiredStudentCount = requiredNewCases + WATCH_COMMENTS.length;
      if (availableCandidates.length < requiredStudentCount) {
        throw new Error(
          `มีนักเรียนโรงเรียนดรุณศึกษาธิการที่ยังไม่มีเคสเพียง ${availableCandidates.length} คน แต่ต้องใช้ ${requiredStudentCount} คน`,
        );
      }

      const candidateByStudentId = new Map(candidates.map((candidate) => [candidate.student_uuid, candidate]));
      let nextCandidate = 0;
      const scenarioStudents = CASE_SCENARIOS.map((scenario) => {
        const existingStudentId = existingCases.get(scenario.caseSummary);
        if (existingStudentId) {
          const existingCandidate = candidateByStudentId.get(existingStudentId);
          if (existingCandidate) return existingCandidate;
        }
        const selected = availableCandidates[nextCandidate];
        nextCandidate += 1;
        return selected;
      });

      const seededStudents = scenarioStudents.filter(Boolean);

      await seedSchoolAttendanceHistory(
        manager,
        school.id,
        historyDates,
        absenceDates,
        seededStudents.map((student) => student.student_uuid),
      );

      for (const [index, scenario] of CASE_SCENARIOS.entries()) {
        const student = scenarioStudents[index];
        if (!student) throw new Error(`ไม่พบข้อมูลนักเรียนสำหรับสถานะ ${scenario.status}`);

        await manager.query(
          `UPDATE classroom_student_comments
           SET problem_description = $3,
               problem_category_code = 'ACADEMIC'
           WHERE classroom_id = $1
             AND person_uuid = $2::uuid
             AND authored_by_user_id = $4
             AND problem_description = $5`,
          [
            student.classroom_id,
            student.person_uuid,
            scenario.teacherComment,
            student.teacher_user_id,
            scenario.caseSummary,
          ],
        );

        await manager.query(
          `INSERT INTO classroom_student_comments (
             classroom_id, person_uuid, problem_category_code,
             problem_description, authored_by_user_id
           )
           SELECT $1, $2::uuid, 'ACADEMIC', $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM classroom_student_comments
             WHERE classroom_id = $1
               AND person_uuid = $2::uuid
               AND problem_description = $3
               AND authored_by_user_id = $4
           )`,
          [
            student.classroom_id,
            student.person_uuid,
            scenario.teacherComment,
            student.teacher_user_id,
          ],
        );

        const [existingCase] = await manager.query(
          `SELECT id FROM cases
           WHERE school_id = $1 AND reason_flagged LIKE $2 AND result_summary = $3
             AND deleted_at IS NULL
           LIMIT 1`,
          [school.id, `${ABSENCE_REASON} %`, scenario.caseSummary],
        );
        const caseId = existingCase?.id ?? (
          await manager.query(
            `INSERT INTO cases (
               student_uuid, student_name, student_school, school_id,
               reason_flagged, status, result_summary, completion_outcome_code,
               created_by, updated_by
             ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $9)
             RETURNING id`,
            [
              student.student_uuid,
              student.student_name,
              school.name,
              school.id,
              `${ABSENCE_REASON} ${ABSENCE_DAY_COUNT} วัน`,
              scenario.status,
              scenario.caseSummary,
              scenario.completionOutcome,
              student.teacher_user_id,
            ],
          )
        )[0].id;

        if (!scenario.taskStatus) continue;

        const [existingTask] = await manager.query(
          `SELECT id FROM tasks
           WHERE case_id = $1 AND task_type = 'VISIT' AND deleted_at IS NULL
           LIMIT 1`,
          [caseId],
        );
        const taskId = existingTask?.id ?? (
          await manager.query(
            `INSERT INTO tasks (
               case_id, status, task_type,
               target_school_id, target_grade, target_room, created_by, updated_by
             ) VALUES ($1, $2, 'VISIT', $3, $4, $5, $6, $6)
             RETURNING id`,
            [caseId, scenario.taskStatus, school.id, student.grade, student.room, student.teacher_user_id],
          )
        )[0].id;

        // เคส IN_PROGRESS ที่ทำเครื่องหมาย linkExpired ใช้ลิงก์ที่หมดอายุแล้วจริง
        // (ไม่ใช่ token ปลอม) เพื่อ demo flow "มอบหมายใหม่เมื่อลิงก์เดิมหมดอายุ"
        const desiredExpiresAt = scenario.linkExpired
          ? new Date(Date.now() - 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const [existingLink] = await manager.query(
          `SELECT id, token_encrypted FROM task_links WHERE task_id = $1 AND deleted_at IS NULL LIMIT 1`,
          [taskId],
        );
        let linkId;
        if (existingLink) {
          linkId = existingLink.id;
          if (existingLink.token_encrypted) {
            await manager.query(`UPDATE task_links SET expires_at = $2 WHERE id = $1`, [
              linkId,
              desiredExpiresAt,
            ]);
          } else {
            // Repair a link seeded before this script stored a recoverable token
            // (magic_link resolves via token_encrypted, not the one-way hash).
            const token = generateToken();
            await manager.query(
              `UPDATE task_links SET token_hash = $2, token_encrypted = $3, expires_at = $4 WHERE id = $1`,
              [linkId, hashToken(token), tokenEncryption.encrypt(token), desiredExpiresAt],
            );
          }
        } else {
          const token = generateToken();
          linkId = (
            await manager.query(
              `INSERT INTO task_links (
                 task_id, token_hash, token_encrypted, assigned_to_name,
                 assigned_to_first_name, assigned_to_last_name, assigned_to_email,
                 subject, status, expires_at, created_by, updated_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
               RETURNING id`,
              [
                taskId,
                hashToken(token),
                tokenEncryption.encrypt(token),
                student.teacher_name,
                student.teacher_first_name,
                student.teacher_last_name,
                student.teacher_email,
                'ติดตามนักเรียนตามความเห็นครูประจำชั้น',
                scenario.linkStatus,
                desiredExpiresAt,
                student.teacher_user_id,
              ],
            )
          )[0].id;
        }

        if (scenario.status !== 'IN_PROGRESS') {
          await manager.query(
            `INSERT INTO task_submissions (
               task_link_id, follow_up_problem_category_code, cause_detail, recommendation,
               case_follow_up_decision, home_visit_exception_code,
               submitted_at, created_by, updated_by
             )
             SELECT $1, 'OTHER', $2, $3, 'REQUEST_REVIEW', $4, now() - interval '1 day', $5, $5
             WHERE NOT EXISTS (SELECT 1 FROM task_submissions WHERE task_link_id = $1)`,
            [
              linkId,
              scenario.caseSummary,
              'ประสานครูประจำชั้นและผู้ปกครอง พร้อมติดตามผลอย่างต่อเนื่อง',
              scenario.status === 'STUDENT_NOT_FOUND' ? 'STUDENT_NOT_FOUND' : null,
              student.teacher_user_id,
            ],
          );
        }

        if (scenario.status === 'RESOLVED') {
          const reviewAction = scenario.completionOutcome === 'REFERRED_AGENCY' ? 'REFER_AGENCY' : 'CLOSE';
          const reviewNote =
            scenario.completionOutcome === 'REFERRED_AGENCY'
              ? 'ส่งต่อหน่วยงานที่เกี่ยวข้องเพื่อดูแลต่อ'
              : 'ติดตามครบถ้วนและปิดเคส';
          // UPDATE-then-INSERT (not the earlier NOT-EXISTS insert) so a case seeded
          // before reviewerAdmin was introduced gets its reviewer repaired too.
          const updated = await manager.query(
            `UPDATE case_reviews SET reviewed_by = $3, source_actor_user_id = $4
             WHERE case_id = $1 AND review_action = $2
             RETURNING id`,
            [caseId, reviewAction, reviewerAdmin.display_name, reviewerAdmin.id],
          );
          if (updated.length === 0) {
            await manager.query(
              `INSERT INTO case_reviews (
                 case_id, review_action, review_note, review_summary,
                 reviewed_by, reviewed_at, source_actor_user_id
               ) VALUES ($1, $2, $3, $4, $5, now(), $6)`,
              [caseId, reviewAction, reviewNote, scenario.caseSummary, reviewerAdmin.display_name, reviewerAdmin.id],
            );
          }
        }
      }

      const watchStudents = availableCandidates.slice(
        nextCandidate,
        nextCandidate + WATCH_COMMENTS.length,
      );
      for (const [index, student] of watchStudents.entries()) {
        await manager.query(
          `INSERT INTO classroom_student_comments (
             classroom_id, person_uuid, problem_category_code,
             problem_description, authored_by_user_id
           )
           SELECT $1, $2::uuid, 'ACADEMIC', $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM classroom_student_comments
             WHERE classroom_id = $1
               AND person_uuid = $2::uuid
               AND problem_description = $3
               AND authored_by_user_id = $4
           )`,
          [student.classroom_id, student.person_uuid, WATCH_COMMENTS[index], student.teacher_user_id],
        );
      }

      const statusCounts = await manager.query(
        `SELECT status, COUNT(*)::int AS count
         FROM cases
         WHERE school_id = $1 AND deleted_at IS NULL
         GROUP BY status ORDER BY status`,
        [school.id],
      );
      const [watchlistCount] = await manager.query(
        `SELECT COUNT(DISTINCT enrollment.student_uuid)::int AS count
         FROM student_term enrollment
         JOIN student_current_enrollment_resolution current_enrollment
           ON current_enrollment.person_uuid = enrollment.person_uuid
          AND current_enrollment.selected_student_uuid = enrollment.student_uuid
          AND current_enrollment.resolution_state = 'ACTIVE'
         JOIN classroom_student_comments comment
           ON comment.classroom_id = enrollment.classroom_id
          AND comment.person_uuid = enrollment.person_uuid
         WHERE enrollment."SchoolID_Onec" = $1 AND enrollment.deleted_at IS NULL`,
        [school.id],
      );
      return { statusCounts, watchlistCount: Number(watchlistCount?.count ?? 0) };
    });

    console.table(result.statusCounts);
    console.log(`Darun watchlist students with teacher comments: ${result.watchlistCount}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

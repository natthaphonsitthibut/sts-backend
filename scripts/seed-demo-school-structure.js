require('dotenv/config');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run demo school structure seed with NODE_ENV=production');
}

const { createHash } = require('crypto');
const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');
const LEGACY_SEED_SOURCE = 'DEMO_SCHOOL_STRUCTURE';
const SEED_SOURCE = 'SYNTHETIC_SCHOOL_STRUCTURE';
const KINDERGARTEN_LABELS = ['อ.1', 'อ.2', 'อ.3'];
const REQUIRED_KINDERGARTEN_LABELS = ['อ.1', 'อ.2'];
const STUDENTS_PER_KINDERGARTEN_CLASSROOM = 12;
const TEACHER_PERMISSIONS = ['home', 'attendance'];

const TEACHER_FIRST_NAMES = [
  'กมลชนก', 'กิตติพงศ์', 'จันทร์เพ็ญ', 'ชลธิชา', 'ณัฐวุฒิ', 'ดวงกมล', 'ธนกฤต', 'นภัสสร',
  'ปกรณ์', 'ปรียานุช', 'พงศกร', 'พิชญา', 'ภัทรวดี', 'รัตนา', 'วรเมธ', 'ศิริพร',
  'สุภาวดี', 'อรทัย', 'อัครเดช', 'อัญชลี', 'เกรียงไกร', 'เบญจมาศ', 'เมธาวี', 'เอกชัย',
];
const TEACHER_FIRST_USERNAMES = [
  'kamonchanok', 'kittiphong', 'chanphen', 'chonthicha', 'nattawut', 'duangkamol',
  'thanakrit', 'napatsorn', 'pakorn', 'preeyanuch', 'phongsakorn', 'pitchaya',
  'phattarawadee', 'rattana', 'woramet', 'siriporn', 'suphawadee', 'orathai',
  'akkharadet', 'anchalee', 'kriengkrai', 'benchamat', 'methavee', 'ekkachai',
];
const TEACHER_LAST_NAMES = [
  'กุลวงศ์', 'แก้วประเสริฐ', 'ใจดี', 'ชูศรี', 'ทองอินทร์', 'ธรรมรักษ์', 'บุญเรือง', 'พัฒนกิจ',
  'มณีรัตน์', 'รุ่งเรือง', 'วงศ์คำ', 'ศรีสวัสดิ์', 'สมบูรณ์', 'สิงห์ทอง', 'สุวรรณดี', 'แสงมณี',
  'อินทร์แก้ว', 'อุดมทรัพย์',
];
const TEACHER_LAST_USERNAMES = [
  'kulwong', 'kaewprasert', 'jaidee', 'chusri', 'thongin', 'thammarak',
  'boonruang', 'pattanakit', 'maneerat', 'rungruang', 'wongkham', 'srisawat',
  'somboon', 'singthong', 'suwandee', 'saengmanee', 'inkaew', 'udomsap',
];
const STUDENT_FIRST_NAMES = [
  'อชิรญา', 'กัญญาวีร์', 'ชนัญชิดา', 'ณิชาภัทร', 'ธัญชนก', 'นภสร',
  'ปุณณภา', 'พิมพ์ชนก', 'ภูริณัฐ', 'รวิสรา', 'วรัญญา', 'ศุภกฤต',
  'สิรินดา', 'อชิระ', 'อริสรา', 'อินทัช', 'กฤตภาส', 'ชญาดา',
  'ญาณิศา', 'ณัฐณิชา', 'ธนภัทร', 'ปภาวรินทร์', 'พชรพล', 'ภัทราพร',
];
const STUDENT_LAST_NAMES = [
  'วัฒนากุล', 'ศรีประเสริฐ', 'สุขเกษม', 'บุญช่วย', 'แก้วกาญจน์', 'พงษ์พิพัฒน์',
  'จิตต์มั่น', 'อินทรสุวรรณ', 'มณีวงศ์', 'ชูศักดิ์', 'ทองมี', 'รัตนโชติ',
  'นาคเจริญ', 'พูลสวัสดิ์', 'แสงทอง', 'สมบัติสุข', 'จันทร์ดี', 'ประสิทธิ์พร',
  'วงศ์วัฒนา', 'คำแสน', 'ศรีสุข', 'ธรรมโชติ', 'กิตติวงศ์', 'รุ่งวัฒนา',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function deterministicUuid(value) {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function syntheticNationalId(schoolSequence, gradeId, roomNumber, studentSequence) {
  return `991${String(schoolSequence).padStart(2, '0')}${String(gradeId).padStart(3, '0')}${String(roomNumber).padStart(2, '0')}${String(studentSequence).padStart(2, '0')}0`;
}

function teacherIdentity(classroomId) {
  const combinationCount = TEACHER_FIRST_NAMES.length * TEACHER_LAST_NAMES.length;
  const identityIndex = createHash('sha256')
    .update(`school-classroom-teacher:${classroomId}`)
    .digest()
    .readUInt32BE(0) % combinationCount;
  const firstNameIndex = identityIndex % TEACHER_FIRST_NAMES.length;
  const lastNameIndex = Math.floor(identityIndex / TEACHER_FIRST_NAMES.length);
  return {
    firstName: TEACHER_FIRST_NAMES[firstNameIndex],
    lastName: TEACHER_LAST_NAMES[lastNameIndex],
    username: `${TEACHER_FIRST_USERNAMES[firstNameIndex]}.${TEACHER_LAST_USERNAMES[lastNameIndex]}.${classroomId}`,
  };
}

function studentName(index) {
  return {
    firstName: STUDENT_FIRST_NAMES[index % STUDENT_FIRST_NAMES.length],
    lastName: STUDENT_LAST_NAMES[Math.floor(index / STUDENT_FIRST_NAMES.length) % STUDENT_LAST_NAMES.length],
  };
}

async function auditStructure(dataSource) {
  const [audit] = await dataSource.query(`
    WITH active_schools AS (
      SELECT id FROM schools WHERE school_status = 'ACTIVE'
    ), active_terms AS (
      SELECT id, school_id FROM school_terms
      WHERE status = 'ACTIVE' AND deleted_at IS NULL
    ), kindergarten AS (
      SELECT id, label FROM grade_levels WHERE label = ANY($1::text[])
    ), school_kindergarten AS (
      SELECT school.id AS school_id,
        COALESCE(BOOL_OR(grade.label = 'อ.1'), FALSE) AS has_k1,
        COALESCE(BOOL_OR(grade.label = 'อ.2'), FALSE) AS has_k2,
        COALESCE(BOOL_OR(grade.label = 'อ.3'), FALSE) AS has_k3
      FROM active_schools school
      LEFT JOIN active_terms term ON term.school_id = school.id
      LEFT JOIN school_classrooms classroom
        ON classroom.school_term_id = term.id
       AND classroom.classroom_status = 'ACTIVE'
       AND classroom.deleted_at IS NULL
      LEFT JOIN kindergarten grade ON grade.id = classroom.grade_level_id
      GROUP BY school.id
    ), active_classrooms AS (
      SELECT classroom.*
      FROM school_classrooms classroom
      JOIN active_terms term ON term.id = classroom.school_term_id
      WHERE classroom.classroom_status = 'ACTIVE' AND classroom.deleted_at IS NULL
    ), valid_homerooms AS (
      SELECT DISTINCT assignment.classroom_id
      FROM classroom_teacher_assignments assignment
      JOIN school_teacher_memberships membership
        ON membership.id = assignment.teacher_membership_id
       AND membership.school_id = assignment.school_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      WHERE assignment.assignment_kind = 'HOMEROOM'
        AND assignment.assignment_status = 'ACTIVE'
        AND assignment.deleted_at IS NULL
    ), kindergarten_rosters AS (
      SELECT classroom.id, COUNT(enrollment.student_uuid)::int AS student_count
      FROM active_classrooms classroom
      JOIN kindergarten grade ON grade.id = classroom.grade_level_id
      LEFT JOIN student_term enrollment
        ON enrollment.classroom_id = classroom.id AND enrollment.deleted_at IS NULL
      GROUP BY classroom.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM active_schools) AS active_schools,
      (SELECT COUNT(*)::int FROM active_classrooms) AS active_classrooms,
      (SELECT COUNT(*)::int FROM kindergarten) AS kindergarten_grade_levels,
      (SELECT COUNT(*)::int FROM school_kindergarten WHERE NOT has_k1 OR NOT has_k2) AS schools_missing_required_kindergarten,
      (SELECT COUNT(*)::int FROM school_kindergarten WHERE has_k3) AS schools_with_k3,
      (SELECT COUNT(*)::int FROM school_kindergarten WHERE NOT has_k3) AS schools_without_k3,
      (SELECT COUNT(*)::int FROM active_classrooms classroom
        WHERE NOT EXISTS (SELECT 1 FROM valid_homerooms homeroom WHERE homeroom.classroom_id = classroom.id)
      ) AS classrooms_without_valid_homeroom,
      (SELECT COUNT(*)::int FROM kindergarten_rosters WHERE student_count < $2) AS kindergarten_classrooms_below_minimum,
      (SELECT COALESCE(MIN(student_count), 0)::int FROM kindergarten_rosters) AS minimum_kindergarten_students,
      (SELECT COUNT(*)::int FROM teachers
        WHERE deleted_at IS NULL
          AND lower(btrim(COALESCE(email, ''))) ~ '^[a-z]+\\.[a-z]+\\.[0-9]+@sts-demo\\.ac\\.th$'
      ) AS synthetic_teachers,
      (SELECT COUNT(*)::int FROM teachers
        WHERE deleted_at IS NULL
          AND lower(btrim(COALESCE(email, ''))) ~ '^[a-z]+\\.[a-z]+\\.[0-9]+@sts-demo\\.ac\\.th$'
          AND teacher_status <> 'ACTIVE'
      ) AS synthetic_teacher_status_issues,
      (SELECT COUNT(*)::int FROM teachers teacher
        WHERE teacher.deleted_at IS NULL
          AND lower(btrim(COALESCE(teacher.email, ''))) ~ '^[a-z]+\\.[a-z]+\\.[0-9]+@sts-demo\\.ac\\.th$'
          AND NOT EXISTS (
            SELECT 1 FROM school_teacher_memberships membership
            WHERE membership.teacher_id = teacher.id
              AND membership.membership_status = 'ACTIVE'
              AND membership.deleted_at IS NULL
          )
      ) AS synthetic_teachers_without_membership,
      -- Teachers do not sign in. A login account for one would be a regression,
      -- not a fixture, so the audit fails on the first sign of one.
      (SELECT COUNT(*)::int FROM users
        WHERE lower(btrim(COALESCE(email, ''))) LIKE '%@sts-demo.ac.th'
          AND username ~ '^[a-z]+\\.[a-z]+\\.[0-9]+$'
      ) AS synthetic_teacher_accounts,
      (SELECT COUNT(*)::int FROM student_person_identifier WHERE source = $3 AND deleted_at IS NULL) AS synthetic_students
  `, [
    KINDERGARTEN_LABELS,
    STUDENTS_PER_KINDERGARTEN_CLASSROOM,
    SEED_SOURCE,
  ]);

  assert(audit.active_schools > 0, 'No active schools are available');
  assert(audit.kindergarten_grade_levels === 3, 'Kindergarten grade catalog is incomplete');
  assert(audit.schools_missing_required_kindergarten === 0, 'Some schools are missing อ.1 or อ.2');
  assert(audit.schools_with_k3 > 0, 'No school offers อ.3');
  assert(audit.schools_without_k3 > 0, 'The demo set must include schools without อ.3');
  assert(audit.classrooms_without_valid_homeroom === 0, 'Some active classrooms have no valid homeroom teacher');
  assert(audit.kindergarten_classrooms_below_minimum === 0, 'Some kindergarten classrooms have too few students');
  assert(audit.synthetic_teachers > 0, 'No generated demo teacher was found');
  assert(audit.synthetic_teacher_status_issues === 0, 'Some generated demo teachers are not active');
  assert(
    audit.synthetic_teachers_without_membership === 0,
    'Some generated demo teachers have no active school membership',
  );
  assert(audit.synthetic_teacher_accounts === 0, 'A generated demo teacher still has a login account');
  return audit;
}

async function seedStructure(dataSource) {
  const [actor] = await dataSource.query(`
    SELECT id
    FROM users
    WHERE status = 'ACTIVE'
      AND data_origin_code = 'DEMO'
      AND username = 'orathai.b'
      AND (role = 'SUPER_ADMIN' OR role = 'ADMIN' OR permissions::jsonb ? 'manage-school-structure')
    LIMIT 1
  `);
  assert(actor?.id, 'No active administrator is available for seed attribution');

  return dataSource.transaction(async (manager) => {
    const [termTemplate] = await manager.query(`
      SELECT academic_year, semester, starts_on::text, ends_on::text
      FROM school_terms
      WHERE starts_on IS NOT NULL AND ends_on IS NOT NULL AND deleted_at IS NULL
      ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        academic_year DESC, semester DESC, id DESC
      LIMIT 1
    `);
    assert(termTemplate, 'No school term is available as a demo date template');

    await manager.query(`
      WITH latest_terms AS (
        SELECT school.id AS school_id, (
          SELECT term.id
          FROM school_terms term
          WHERE term.school_id = school.id AND term.deleted_at IS NULL
          ORDER BY term.academic_year DESC, term.semester DESC, term.id DESC
          LIMIT 1
        ) AS school_term_id
        FROM schools school
        WHERE school.school_status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM school_terms active_term
            WHERE active_term.school_id = school.id
              AND active_term.status = 'ACTIVE'
              AND active_term.deleted_at IS NULL
          )
      )
      UPDATE school_terms term
      SET status = 'ACTIVE',
          starts_on = COALESCE(term.starts_on, $2::date),
          ends_on = COALESCE(term.ends_on, $3::date),
          updated_by = $1::int,
          deleted_at = NULL,
          deleted_by = NULL
      FROM latest_terms latest
      WHERE term.id = latest.school_term_id
    `, [actor.id, termTemplate.starts_on, termTemplate.ends_on]);

    await manager.query(`
      INSERT INTO school_terms (
        school_id, academic_year, semester, starts_on, ends_on,
        status, created_by, updated_by
      )
      SELECT school.id, $2::int, $3::smallint, $4::date, $5::date,
        'ACTIVE', $1::int, $1::int
      FROM schools school
      WHERE school.school_status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM school_terms term
          WHERE term.school_id = school.id AND term.deleted_at IS NULL
        )
      ON CONFLICT (school_id, academic_year, semester) DO NOTHING
    `, [
      actor.id,
      termTemplate.academic_year,
      termTemplate.semester,
      termTemplate.starts_on,
      termTemplate.ends_on,
    ]);

    const schools = await manager.query(`
      SELECT school.id, school.name, term.id AS school_term_id,
        term.academic_year, term.semester,
        COALESCE(
          NULLIF(ARRAY(
            SELECT pattern.legacy_room_number
            FROM school_classrooms pattern
            WHERE pattern.school_term_id = term.id
              AND pattern.classroom_status = 'ACTIVE'
              AND pattern.deleted_at IS NULL
              AND pattern.legacy_room_number IS NOT NULL
              AND pattern.legacy_room_number > 0
            GROUP BY pattern.legacy_room_number
            HAVING COUNT(DISTINCT pattern.grade_level_id) >= 2
            ORDER BY pattern.legacy_room_number
          ), ARRAY[]::integer[]),
          ARRAY[1]
        ) AS room_numbers
      FROM schools school
      JOIN school_terms term
        ON term.school_id = school.id
       AND term.status = 'ACTIVE'
       AND term.deleted_at IS NULL
      WHERE school.school_status = 'ACTIVE'
      ORDER BY school.id
    `);
    assert(schools.length > 0, 'No active school term is available');

    const grades = await manager.query(
      `SELECT id, label FROM grade_levels WHERE label = ANY($1::text[]) ORDER BY id`,
      [KINDERGARTEN_LABELS],
    );
    assert(grades.length === 3, 'Run the kindergarten grade migration before seeding');
    const gradeByLabel = new Map(grades.map((grade) => [grade.label, Number(grade.id)]));

    const kindergartenPlan = [];
    schools.forEach((school, schoolIndex) => {
      const labels = (schoolIndex + 1) % 3 === 0
        ? REQUIRED_KINDERGARTEN_LABELS
        : KINDERGARTEN_LABELS;
      for (const label of labels) {
        for (const rawRoomNumber of school.room_numbers) {
          const roomNumber = Number(rawRoomNumber);
          kindergartenPlan.push({
            schoolTermId: Number(school.school_term_id),
            schoolId: Number(school.id),
            gradeLevelId: gradeByLabel.get(label),
            roomNumber,
            roomCode: String(roomNumber),
            roomName: `ห้อง ${label}/${roomNumber}`,
          });
        }
      }
    });

    await manager.query(`
      INSERT INTO school_classrooms (
        school_term_id, school_id, grade_level_id, legacy_room_number,
        room_code, room_name, classroom_status, created_by, updated_by
      )
      SELECT plan.school_term_id, plan.school_id, plan.grade_level_id, plan.room_number,
        plan.room_code, plan.room_name, 'ACTIVE', $2::int, $2::int
      FROM jsonb_to_recordset($1::jsonb) AS plan(
        school_term_id BIGINT, school_id INTEGER, grade_level_id INTEGER,
        room_number INTEGER, room_code VARCHAR(32), room_name VARCHAR(120)
      )
      ON CONFLICT DO NOTHING
    `, [JSON.stringify(kindergartenPlan.map((item) => ({
      school_term_id: item.schoolTermId,
      school_id: item.schoolId,
      grade_level_id: item.gradeLevelId,
      room_number: item.roomNumber,
      room_code: item.roomCode,
      room_name: item.roomName,
    }))), actor.id]);

    const classrooms = await manager.query(`
      SELECT classroom.id, classroom.school_id, classroom.school_term_id,
        classroom.grade_level_id, classroom.legacy_room_number,
        grade.label AS grade_label, school.name AS school_name,
        term.academic_year, term.semester
      FROM school_classrooms classroom
      JOIN school_terms term
        ON term.id = classroom.school_term_id
       AND term.status = 'ACTIVE'
       AND term.deleted_at IS NULL
      JOIN schools school ON school.id = classroom.school_id AND school.school_status = 'ACTIVE'
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      WHERE classroom.classroom_status = 'ACTIVE'
        AND classroom.deleted_at IS NULL
        AND classroom.legacy_room_number IS NOT NULL
      ORDER BY classroom.school_id, classroom.grade_level_id, classroom.legacy_room_number
    `);

    const teacherPlan = classrooms.map((classroom) => {
      const identity = teacherIdentity(classroom.id);
      return {
        classroom_id: Number(classroom.id),
        school_id: Number(classroom.school_id),
        legacy_username: `demo_teacher_${classroom.school_id}_${classroom.grade_level_id}_${classroom.legacy_room_number}`,
        username: identity.username,
        first_name: identity.firstName,
        last_name: identity.lastName,
        email: `${identity.username}@sts-demo.ac.th`,
        school_name: classroom.school_name,
      };
    });

    await manager.query(`
      CREATE TEMP TABLE demo_teacher_plan_20260716 (
        classroom_id BIGINT PRIMARY KEY,
        school_id INTEGER NOT NULL,
        legacy_username TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        school_name TEXT NOT NULL
      ) ON COMMIT DROP;
    `);
    await manager.query(`
      INSERT INTO demo_teacher_plan_20260716
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS plan(
        classroom_id BIGINT, school_id INTEGER, legacy_username TEXT, username TEXT,
        first_name TEXT, last_name TEXT, email TEXT, school_name TEXT
      )
    `, [JSON.stringify(teacherPlan)]);

    await manager.query(`
      INSERT INTO teachers (
        first_name, last_name, email, teacher_status, created_by, updated_by
      )
      SELECT plan.first_name, plan.last_name, plan.email, 'ACTIVE', $1::int, $1::int
      FROM demo_teacher_plan_20260716 plan
      ON CONFLICT (lower(btrim(email))) WHERE email IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        teacher_status = 'ACTIVE',
        deleted_at = NULL,
        deleted_by = NULL,
        updated_by = EXCLUDED.updated_by
    `, [actor.id]);

    const [{ missing_teachers: missingTeachers }] = await manager.query(`
      SELECT COUNT(*)::int AS missing_teachers
      FROM demo_teacher_plan_20260716 plan
      LEFT JOIN teachers teacher
        ON lower(btrim(teacher.email)) = lower(btrim(plan.email))
       AND teacher.deleted_at IS NULL
      WHERE teacher.id IS NULL
    `);
    assert(missingTeachers === 0, 'A generated teacher could not be prepared safely');

    await manager.query(`
      INSERT INTO school_teacher_memberships (
        school_id, teacher_id, membership_status, started_on, created_by, updated_by
      )
      SELECT DISTINCT plan.school_id, teacher.id, 'ACTIVE', CURRENT_DATE, $1::int, $1::int
      FROM demo_teacher_plan_20260716 plan
      JOIN teachers teacher
        ON lower(btrim(teacher.email)) = lower(btrim(plan.email))
       AND teacher.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM school_teacher_memberships membership
        WHERE membership.school_id = plan.school_id
          AND membership.teacher_id = teacher.id
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
      )
      ON CONFLICT DO NOTHING
    `, [actor.id]);

    await manager.query(`
      UPDATE classroom_teacher_assignments assignment
      SET assignment_status = 'INACTIVE',
          effective_until = GREATEST(CURRENT_DATE, assignment.effective_on),
          updated_by = $1
      WHERE assignment.assignment_kind = 'HOMEROOM'
        AND assignment.assignment_status = 'ACTIVE'
        AND assignment.deleted_at IS NULL
        AND assignment.classroom_id IN (SELECT classroom_id FROM demo_teacher_plan_20260716)
        AND NOT EXISTS (
          SELECT 1
          FROM school_teacher_memberships membership
          JOIN teachers teacher ON teacher.id = membership.teacher_id
          WHERE membership.id = assignment.teacher_membership_id
            AND membership.school_id = assignment.school_id
            AND membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
            AND teacher.teacher_status = 'ACTIVE'
            AND teacher.deleted_at IS NULL
        )
    `, [actor.id]);

    await manager.query(`
      INSERT INTO classroom_teacher_assignments (
        school_id, classroom_id, teacher_membership_id, subject_id,
        assignment_kind, assignment_status, effective_on, created_by, updated_by
      )
      SELECT plan.school_id, plan.classroom_id, membership.id, NULL,
        'HOMEROOM', 'ACTIVE', CURRENT_DATE, $1::int, $1::int
      FROM demo_teacher_plan_20260716 plan
      JOIN teachers teacher
        ON lower(btrim(teacher.email)) = lower(btrim(plan.email))
       AND teacher.deleted_at IS NULL
      JOIN school_teacher_memberships membership
        ON membership.school_id = plan.school_id
       AND membership.teacher_id = teacher.id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM classroom_teacher_assignments assignment
        WHERE assignment.classroom_id = plan.classroom_id
          AND assignment.assignment_kind = 'HOMEROOM'
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
      )
      ON CONFLICT DO NOTHING
    `, [actor.id]);

    const schoolSequenceById = new Map(schools.map((school, index) => [Number(school.id), index + 1]));
    const kindergartenPlanKeys = new Set(
      kindergartenPlan.map((item) =>
        `${item.schoolTermId}:${item.gradeLevelId}:${item.roomNumber}`,
      ),
    );
    const kindergartenClassrooms = classrooms.filter((classroom) =>
      KINDERGARTEN_LABELS.includes(classroom.grade_label) &&
      kindergartenPlanKeys.has(
        `${classroom.school_term_id}:${classroom.grade_level_id}:${classroom.legacy_room_number}`,
      ),
    );
    const studentPlan = [];
    let studentNameIndex = 0;
    for (const classroom of kindergartenClassrooms) {
      for (let studentSequence = 1; studentSequence <= STUDENTS_PER_KINDERGARTEN_CLASSROOM; studentSequence += 1) {
        const schoolSequence = schoolSequenceById.get(Number(classroom.school_id));
        const nationalId = syntheticNationalId(
          schoolSequence,
          Number(classroom.grade_level_id),
          Number(classroom.legacy_room_number),
          studentSequence,
        );
        const name = studentName(studentNameIndex);
        studentNameIndex += 1;
        studentPlan.push({
          person_uuid: deterministicUuid(`${LEGACY_SEED_SOURCE}:person:${nationalId}`),
          student_uuid: deterministicUuid(`${LEGACY_SEED_SOURCE}:enrollment:${nationalId}:${classroom.school_term_id}`),
          person_id: nationalId,
          first_name: name.firstName,
          last_name: name.lastName,
          school_id: Number(classroom.school_id),
          grade_level_id: Number(classroom.grade_level_id),
          room_number: Number(classroom.legacy_room_number),
          academic_year: Number(classroom.academic_year),
          semester: Number(classroom.semester),
          school_term_id: Number(classroom.school_term_id),
          classroom_id: Number(classroom.id),
        });
      }
    }

    await manager.query(`
      CREATE TEMP TABLE demo_student_plan_20260716 (
        person_uuid UUID PRIMARY KEY,
        student_uuid UUID NOT NULL UNIQUE,
        person_id TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        school_id INTEGER NOT NULL,
        grade_level_id INTEGER NOT NULL,
        room_number INTEGER NOT NULL,
        academic_year INTEGER NOT NULL,
        semester INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        classroom_id BIGINT NOT NULL
      ) ON COMMIT DROP;
    `);
    await manager.query(`
      INSERT INTO demo_student_plan_20260716
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS plan(
        person_uuid UUID, student_uuid UUID, person_id TEXT,
        first_name TEXT, last_name TEXT, school_id INTEGER,
        grade_level_id INTEGER, room_number INTEGER, academic_year INTEGER,
        semester INTEGER, school_term_id BIGINT, classroom_id BIGINT
      )
    `, [JSON.stringify(studentPlan)]);

    await manager.query(`
      INSERT INTO student_person (person_uuid, identity_status, created_by, updated_by)
      SELECT person_uuid, 'ACTIVE', $1::int, $1::int
      FROM demo_student_plan_20260716
      ON CONFLICT (person_uuid) DO UPDATE
      SET identity_status = 'ACTIVE', updated_by = EXCLUDED.updated_by,
          deleted_at = NULL, deleted_by = NULL
    `, [actor.id]);

    await manager.query(`
      INSERT INTO student_person_identifier (
        person_uuid, identifier_type, identifier_value, identifier_normalized,
        is_primary, source, created_by, updated_by
      )
      SELECT plan.person_uuid, 'NATIONAL_ID', plan.person_id, plan.person_id,
        TRUE, $2, $1::int, $1::int
      FROM demo_student_plan_20260716 plan
      WHERE NOT EXISTS (
        SELECT 1 FROM student_person_identifier identifier
        WHERE identifier.person_uuid = plan.person_uuid
          AND identifier.identifier_type = 'NATIONAL_ID'
          AND identifier.identifier_normalized = plan.person_id
          AND identifier.deleted_at IS NULL
      )
    `, [actor.id, SEED_SOURCE]);

    await manager.query(`
      UPDATE student_person_identifier identifier
      SET source = $2, updated_by = $3::int
      WHERE identifier.person_uuid IN (SELECT person_uuid FROM demo_student_plan_20260716)
        AND identifier.source = $1
        AND identifier.deleted_at IS NULL
    `, [LEGACY_SEED_SOURCE, SEED_SOURCE, actor.id]);

    const [activeStatus] = await manager.query(`
      SELECT code
      FROM student_status
      WHERE category = 'ACTIVE' AND is_enabled = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
      LIMIT 1
    `);
    assert(activeStatus?.code, 'No active student status is available');

    await manager.query(`
      INSERT INTO student_term (
        student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
        "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
        "StudentStatusID_Onec", student_status_code,
        "AcademicYear_Onec", "Semester_Onec", school_term_id, classroom_id,
        "NationalityID_Onec", created_by, updated_by
      )
      SELECT plan.student_uuid, plan.person_uuid, plan.person_id, plan.first_name, plan.last_name,
        plan.school_id, plan.grade_level_id, plan.room_number,
        $2::int, $2::int, plan.academic_year, plan.semester, plan.school_term_id, plan.classroom_id,
        99, $1::int, $1::int
      FROM demo_student_plan_20260716 plan
      ON CONFLICT (person_uuid, "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec")
      DO UPDATE SET
        "FirstName_Onec" = EXCLUDED."FirstName_Onec",
        "LastName_Onec" = EXCLUDED."LastName_Onec",
        "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
        "RoomID_Onec" = EXCLUDED."RoomID_Onec",
        "StudentStatusID_Onec" = EXCLUDED."StudentStatusID_Onec",
        student_status_code = EXCLUDED.student_status_code,
        school_term_id = EXCLUDED.school_term_id,
        classroom_id = EXCLUDED.classroom_id,
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
    `, [actor.id, activeStatus.code]);

    return {
      plannedKindergartenClassrooms: kindergartenPlan.length,
      plannedTeachers: teacherPlan.length,
      plannedKindergartenStudents: studentPlan.length,
    };
  });
}

async function main() {
  const dataSource = appDataSource;
  await dataSource.initialize();
  try {
    let seedResult = null;
    if (!AUDIT_ONLY) {
      seedResult = await seedStructure(dataSource);
    }
    const audit = await auditStructure(dataSource);
    console.log(JSON.stringify({ mode: AUDIT_ONLY ? 'audit' : 'seed', seed: seedResult, audit }, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

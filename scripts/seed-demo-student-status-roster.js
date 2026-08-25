const { createHash } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run demo student status roster seed with NODE_ENV=production');
}

const SEED_SOURCE = 'DEMO_STUDENT_STATUS_ROSTER';
const QUARANTINE_BATCH_ID = deterministicUuid(`${SEED_SOURCE}:quarantine-batch`);
const ACADEMIC_YEAR = 2569;
const SEMESTER = 1;
const NATIONALITY_THAI = 99;

const DEMO_STATUSES = [
  {
    code: 50,
    label: 'เสียชีวิต',
    category: 'DECEASED',
    badgeVariant: 'secondary',
    isActiveForLogin: false,
    isTerminal: true,
    requiresFollowup: false,
    sortOrder: 50,
  },
  {
    code: 90,
    label: 'ยังไม่ได้จับคู่',
    category: 'UNMATCHED',
    badgeVariant: 'warning',
    isActiveForLogin: false,
    isTerminal: false,
    requiresFollowup: true,
    sortOrder: 90,
  },
];

const STUDENTS = [
  [
    'ACTIVE',
    'ณัฐวุฒิ',
    'ใจตรง',
    10,
    10010002,
    421,
    1,
    3.42,
    '12',
    'ถนนสุเทพ',
    'ซอยชมดอย 3',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'สุเทพ',
    '50200',
    18.7944,
    98.9651,
  ],
  [
    'ACTIVE',
    'กัญญาพัชร',
    'แสงมณี',
    10,
    10010002,
    421,
    1,
    3.76,
    '44/2',
    'ถนนห้วยแก้ว',
    'ซอยอินทนิล',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'ช้างเผือก',
    '50300',
    18.8021,
    98.9674,
  ],
  [
    'ACTIVE',
    'พีรวิชญ์',
    'วงศ์คำ',
    10,
    10010003,
    422,
    2,
    3.18,
    '85',
    'ถนนมิตรภาพ',
    'ซอยศรีจันทร์ 8',
    'ขอนแก่น',
    'เมืองขอนแก่น',
    'ในเมือง',
    '40000',
    16.4322,
    102.8236,
  ],
  [
    'ACTIVE',
    'ปาลิตา',
    'บุญรักษา',
    10,
    10010004,
    111,
    3,
    3.64,
    '9/1',
    'ถนนสรงประภา',
    'ซอยประชาอุทิศ',
    'กรุงเทพมหานคร',
    'ดอนเมือง',
    'สีกัน',
    '10210',
    13.9184,
    100.5946,
  ],

  [
    'GRADUATED',
    'วรเมธ',
    'ศรีสุข',
    20,
    10010002,
    423,
    1,
    3.21,
    '23',
    'ถนนคันคลองชลประทาน',
    'ซอยบ้านใหม่',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'สุเทพ',
    '50200',
    18.7869,
    98.9582,
  ],
  [
    'GRADUATED',
    'ภัทราพร',
    'แก้วอินทร์',
    20,
    10010003,
    423,
    2,
    3.88,
    '71/4',
    'ถนนกลางเมือง',
    'ซอยหน้าเมือง 5',
    'ขอนแก่น',
    'เมืองขอนแก่น',
    'ในเมือง',
    '40000',
    16.4377,
    102.8349,
  ],
  [
    'GRADUATED',
    'ธนกฤต',
    'ยอดยิ่ง',
    20,
    10010005,
    423,
    1,
    2.94,
    '101',
    'ถนนโพศรี',
    'ซอยบ้านขาว 2',
    'อุดรธานี',
    'เมืองอุดรธานี',
    'บ้านขาว',
    '41000',
    17.3969,
    102.7893,
  ],
  [
    'GRADUATED',
    'สุพิชญา',
    'ทองประเสริฐ',
    20,
    10010001,
    106,
    2,
    3.57,
    '16',
    'ถนนมหาไชย',
    'ตรอกวัดกลาง',
    'กรุงเทพมหานคร',
    'พระนคร',
    'สำราญราษฎร์',
    '10200',
    13.7549,
    100.5051,
  ],

  [
    'WITHDRAWN',
    'อภิสิทธิ์',
    'คำดี',
    30,
    10010002,
    112,
    1,
    2.11,
    '55',
    'ถนนสุเทพ',
    'ซอยร่วมใจ',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'สุเทพ',
    '50200',
    18.7902,
    98.9544,
  ],
  [
    'WITHDRAWN',
    'ชญานิศ',
    'เหลืองอร่าม',
    30,
    10010003,
    113,
    2,
    2.48,
    '37/8',
    'ถนนประชาสโมสร',
    'ซอยชุมชนสามเหลี่ยม',
    'ขอนแก่น',
    'เมืองขอนแก่น',
    'ในเมือง',
    '40000',
    16.4468,
    102.8285,
  ],
  [
    'WITHDRAWN',
    'ปกรณ์',
    'สมานมิตร',
    30,
    10010005,
    111,
    3,
    1.95,
    '64',
    'ถนนอุดรดุษฎี',
    'ซอยบ้านขาว 4',
    'อุดรธานี',
    'เมืองอุดรธานี',
    'บ้านขาว',
    '41000',
    17.4156,
    102.7866,
  ],
  [
    'WITHDRAWN',
    'มณีรัตน์',
    'จันทร์นวล',
    30,
    10010004,
    421,
    1,
    2.32,
    '28/3',
    'ถนนวิภาวดีรังสิต',
    'ซอยสีกัน 12',
    'กรุงเทพมหานคร',
    'ดอนเมือง',
    'สีกัน',
    '10210',
    13.9149,
    100.6035,
  ],

  [
    'TRANSFERRED',
    'กิตติธัช',
    'ปัญญาไว',
    40,
    10010002,
    102,
    1,
    3.04,
    '13',
    'ถนนนิมมานเหมินท์',
    'ซอยสุขเกษม',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'สุเทพ',
    '50200',
    18.7975,
    98.9679,
  ],
  [
    'TRANSFERRED',
    'นฤมล',
    'พรหมรักษ์',
    40,
    10010003,
    103,
    2,
    3.49,
    '91',
    'ถนนกัลปพฤกษ์',
    'ซอยแก่นนคร',
    'ขอนแก่น',
    'เมืองขอนแก่น',
    'ในเมือง',
    '40000',
    16.4176,
    102.8341,
  ],
  [
    'TRANSFERRED',
    'ศุภณัฐ',
    'อินทะวงศ์',
    40,
    10010005,
    104,
    1,
    2.86,
    '42/5',
    'ถนนทหาร',
    'ซอยหนองบัว',
    'อุดรธานี',
    'เมืองอุดรธานี',
    'บ้านขาว',
    '41000',
    17.4058,
    102.7907,
  ],
  [
    'TRANSFERRED',
    'อริสรา',
    'ประทีปทอง',
    40,
    10010001,
    105,
    2,
    3.31,
    '6',
    'ถนนบำรุงเมือง',
    'ตรอกศาลเจ้า',
    'กรุงเทพมหานคร',
    'พระนคร',
    'สำราญราษฎร์',
    '10200',
    13.7513,
    100.5018,
  ],

  [
    'DECEASED',
    'ธนภัทร',
    'สุขเกษม',
    50,
    10010002,
    112,
    2,
    2.74,
    '19',
    'ถนนสุเทพ',
    'ซอยสวนดอก',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'สุเทพ',
    '50200',
    18.7881,
    98.9703,
  ],
  [
    'DECEASED',
    'พิชชาภา',
    'ธรรมวงศ์',
    50,
    10010003,
    111,
    1,
    3.02,
    '75/1',
    'ถนนศรีจันทร์',
    'ซอยตลาดต้นตาล',
    'ขอนแก่น',
    'เมืองขอนแก่น',
    'ในเมือง',
    '40000',
    16.4249,
    102.8155,
  ],
  [
    'DECEASED',
    'ภูริณัฐ',
    'แก่นจันทร์',
    50,
    10010005,
    101,
    2,
    2.67,
    '33',
    'ถนนรอบเมือง',
    'ซอยบ้านขาว 7',
    'อุดรธานี',
    'เมืองอุดรธานี',
    'บ้านขาว',
    '41000',
    17.4002,
    102.7813,
  ],
  [
    'DECEASED',
    'ณิชาภา',
    'เพชรสว่าง',
    50,
    10010004,
    102,
    3,
    3.11,
    '58/6',
    'ถนนช่างอากาศอุทิศ',
    'ซอยสีกัน 9',
    'กรุงเทพมหานคร',
    'ดอนเมือง',
    'สีกัน',
    '10210',
    13.9211,
    100.5985,
  ],

  [
    'UNMATCHED',
    'สรวิชญ์',
    'ภูผา',
    90,
    10010002,
    113,
    1,
    2.89,
    '29',
    'ถนนสุเทพ',
    'ซอยวัดอุโมงค์',
    'เชียงใหม่',
    'เมืองเชียงใหม่',
    'สุเทพ',
    '50200',
    18.7824,
    98.9612,
  ],
  [
    'UNMATCHED',
    'รินรดา',
    'นาคะวารี',
    90,
    10010003,
    421,
    2,
    3.08,
    '82/2',
    'ถนนเหล่านาดี',
    'ซอยบึงแก่นนคร',
    'ขอนแก่น',
    'เมืองขอนแก่น',
    'ในเมือง',
    '40000',
    16.4104,
    102.8281,
  ],
  [
    'UNMATCHED',
    'พัชรพล',
    'สายทอง',
    90,
    10010005,
    422,
    1,
    2.56,
    '47',
    'ถนนอุดรธานี-หนองคาย',
    'ซอยหนองประจักษ์',
    'อุดรธานี',
    'เมืองอุดรธานี',
    'บ้านขาว',
    '41000',
    17.4141,
    102.7819,
  ],
  [
    'UNMATCHED',
    'จิรัชญา',
    'เมืองแก้ว',
    90,
    10010001,
    103,
    2,
    3.22,
    '11/9',
    'ถนนดินสอ',
    'ตรอกสำราญ',
    'กรุงเทพมหานคร',
    'พระนคร',
    'สำราญราษฎร์',
    '10200',
    13.7568,
    100.5027,
  ],
];

const QUARANTINE_ROWS = [
  ['PENDING', 'IDENTIFIER_CONFLICT', 10010002, 421, 1, 10, 'อรณิชา', 'แสงแก้ว', '9901000000012'],
  [
    'PENDING',
    'UNMAPPED_STUDENT_STATUS',
    10010002,
    112,
    1,
    90,
    'ธนดล',
    'ปรีชาวงศ์',
    '9901000000029',
  ],
  ['PENDING', 'GRADE_NOT_FOUND', 10010002, 999, 2, 10, 'เบญญาภา', 'วงศ์สุริยา', '9901000000036'],
  ['PENDING', 'ROOM_NOT_FOUND', 10010003, 421, 99, 10, 'กรวิชญ์', 'ภูมิสวัสดิ์', '9901000000043'],
  [
    'PENDING',
    'MISSING_NATURAL_KEY_FIELD',
    10010004,
    111,
    1,
    10,
    'ชลธิชา',
    'ใจงาม',
    '9901000000050',
  ],
  ['PENDING', 'SCHOOL_NOT_FOUND', 99999999, 101, 1, 10, 'ปุณณวิช', 'ไชยรักษ์', '9901000000067'],

  ['RESOLVED', 'IDENTIFIER_CONFLICT', 10010002, 421, 1, 10, 'ณัฐธิดา', 'คำมูล', '9901000000074'],
  ['RESOLVED', 'DUPLICATE_ROW_IN_FILE', 10010002, 112, 2, 10, 'พงศกร', 'สารินทร์', '9901000000081'],
  ['RESOLVED', 'UNMAPPED_STUDENT_STATUS', 10010002, 113, 1, 90, 'กมลชนก', 'มีสุข', '9901000000098'],
  [
    'RESOLVED',
    'NAME_CONFLICT_FOR_IDENTIFIER',
    10010003,
    422,
    2,
    10,
    'รชต',
    'แก่นนคร',
    '9901000000104',
  ],
  ['RESOLVED', 'ROOM_NOT_FOUND', 10010004, 102, 4, 10, 'ภคพร', 'ทองดี', '9901000000111'],
  [
    'RESOLVED',
    'STATUS_CAUSE_UNMAPPED',
    10010005,
    421,
    1,
    30,
    'วายุ',
    'จันทร์สว่าง',
    '9901000000128',
  ],

  [
    'REJECTED',
    'INVALID_NATIONAL_ID_CHECKSUM',
    10010002,
    421,
    1,
    10,
    'กฤตภาส',
    'จงรักษ์',
    '9901000000135',
  ],
  ['REJECTED', 'BLANK_REQUIRED_IDENTITY', 10010002, 112, 1, 10, 'มัณฑนา', 'ภักดี', ''],
  [
    'REJECTED',
    'MULTIPLE_ACTIVE_ENROLLMENTS',
    10010002,
    113,
    2,
    10,
    'วรัญญู',
    'สุวรรณ',
    '9901000000159',
  ],
  ['REJECTED', 'GRADE_NOT_FOUND', 10010003, 998, 1, 10, 'อาทิตยา', 'แสนดี', '9901000000166'],
  ['REJECTED', 'SCHOOL_NOT_FOUND', 99999998, 421, 1, 10, 'ภูมิพัฒน์', 'ศรีประภา', '9901000000173'],
  [
    'REJECTED',
    'MISSING_NATURAL_KEY_FIELD',
    10010004,
    111,
    1,
    10,
    'ณัฐกานต์',
    'เรืองฤทธิ์',
    '9901000000180',
  ],
];

function deterministicUuid(value) {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function syntheticNationalId(index) {
  return `9900000${String(index + 1).padStart(6, '0')}`;
}

async function queryOne(dataSource, sql, params = []) {
  const rows = await dataSource.query(sql, params);
  return rows[0] ?? null;
}

async function findAuditActorId(dataSource) {
  const actor = await queryOne(
    dataSource,
    `
      SELECT id
      FROM users
      WHERE status = 'ACTIVE'
        AND data_origin_code = 'DEMO'
        AND username = 'orathai.b'
        AND (role = 'SUPER_ADMIN' OR role = 'ADMIN' OR permissions::jsonb ? 'manage-students')
      LIMIT 1
    `,
  );
  return actor?.id ?? null;
}

async function ensureDemoStatuses(dataSource, actorId) {
  for (const status of DEMO_STATUSES) {
    await dataSource.query(
      `
        INSERT INTO student_status (
          code, label_th, category, badge_variant, is_active_for_login, is_terminal,
          requires_followup, is_enabled, sort_order, source_system, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, 'DEMO', $9, $9)
        ON CONFLICT (code) DO UPDATE SET
          label_th = EXCLUDED.label_th,
          category = EXCLUDED.category,
          badge_variant = EXCLUDED.badge_variant,
          is_active_for_login = EXCLUDED.is_active_for_login,
          is_terminal = EXCLUDED.is_terminal,
          requires_followup = EXCLUDED.requires_followup,
          is_enabled = TRUE,
          sort_order = EXCLUDED.sort_order,
          source_system = EXCLUDED.source_system,
          updated_by = EXCLUDED.updated_by,
          deleted_at = NULL,
          deleted_by = NULL
        WHERE student_status.source_system = 'DEMO'
      `,
      [
        status.code,
        status.label,
        status.category,
        status.badgeVariant,
        status.isActiveForLogin,
        status.isTerminal,
        status.requiresFollowup,
        status.sortOrder,
        actorId,
      ],
    );
  }
}

async function loadReferenceMaps(dataSource) {
  const schools = await dataSource.query(
    `
      SELECT id, name, province, district, sub_district
      FROM schools
      WHERE id = ANY($1::int[])
      ORDER BY id
    `,
    [[10010001, 10010002, 10010003, 10010004, 10010005]],
  );
  const fallbackSchools =
    schools.length > 0
      ? schools
      : await dataSource.query(
          `SELECT id, name, province, district, sub_district FROM schools ORDER BY id LIMIT 5`,
        );
  const grades = await dataSource.query(
    `SELECT id, label FROM grade_levels WHERE id = ANY($1::int[]) ORDER BY id`,
    [[101, 102, 103, 104, 105, 106, 111, 112, 113, 421, 422, 423]],
  );
  const fallbackGrades =
    grades.length > 0
      ? grades
      : await dataSource.query(`SELECT id, label FROM grade_levels ORDER BY id LIMIT 12`);

  if (fallbackSchools.length === 0) {
    throw new Error('Demo seed requires at least one school');
  }
  if (fallbackGrades.length === 0) {
    throw new Error('Demo seed requires at least one grade level');
  }

  return {
    schoolsById: new Map(fallbackSchools.map((school) => [Number(school.id), school])),
    defaultSchool: fallbackSchools[0],
    gradesById: new Map(fallbackGrades.map((grade) => [Number(grade.id), grade])),
    defaultGrade: fallbackGrades[0],
  };
}

function buildStudent(row, index, references) {
  const [
    category,
    firstName,
    lastName,
    statusCode,
    requestedSchoolId,
    requestedGradeId,
    roomId,
    gpax,
    houseNo,
    street,
    soi,
    province,
    district,
    subDistrict,
    postalCode,
    latitude,
    longitude,
  ] = row;
  const school = references.schoolsById.get(requestedSchoolId) ?? references.defaultSchool;
  const grade = references.gradesById.get(requestedGradeId) ?? references.defaultGrade;
  const nationalId = syntheticNationalId(index);
  const key = `${SEED_SOURCE}:${category}:${index + 1}`;
  return {
    category,
    firstName,
    lastName,
    statusCode,
    schoolId: Number(school.id),
    gradeId: Number(grade.id),
    roomId,
    gpax,
    houseNo,
    street,
    soi,
    province: province || school.province,
    district: district || school.district,
    subDistrict: subDistrict || school.sub_district,
    postalCode,
    latitude,
    longitude,
    nationalId,
    personUuid: deterministicUuid(`${key}:person`),
    studentUuid: deterministicUuid(`${key}:student:${ACADEMIC_YEAR}:${SEMESTER}`),
    personIdOnec: nationalId,
    schoolAdmissionYear: ACADEMIC_YEAR - Math.max(1, Math.min(6, Number(roomId))),
  };
}

async function upsertStudent(dataSource, student, actorId) {
  await dataSource.query(
    `
      INSERT INTO student_person (
        person_uuid, identity_status, created_by, updated_by, deleted_at, deleted_by
      )
      VALUES ($1::uuid, 'ACTIVE', $2, $2, NULL, NULL)
      ON CONFLICT (person_uuid) DO UPDATE SET
        identity_status = 'ACTIVE',
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
    `,
    [student.personUuid, actorId],
  );

  await dataSource.query(
    `
      DELETE FROM student_person_identifier
      WHERE person_uuid = $1::uuid
        AND source = $2
    `,
    [student.personUuid, SEED_SOURCE],
  );
  await dataSource.query(
    `
      INSERT INTO student_person_identifier (
        person_uuid, identifier_type, identifier_value, identifier_normalized,
        is_primary, source, created_by, updated_by
      )
      VALUES ($1::uuid, 'NATIONAL_ID', $2, $2, TRUE, $3, $4, $4)
    `,
    [student.personUuid, student.nationalId, SEED_SOURCE, actorId],
  );

  await dataSource.query(
    `
      INSERT INTO student_term (
        student_uuid, person_uuid, "AcademicYear_Onec", "Semester_Onec",
        "SchoolID_Onec", "PersonID_Onec", "PrefixID_Onec", "FirstName_Onec",
        "LastName_Onec", "GenderID_Onec", "NationalityID_Onec",
        "VillageNumber_Onec", "Street_Onec", "Soi_Onec",
        "SchoolAdmissionYear_Onec", "GradeLevelID_Onec", "RoomID_Onec",
        "GPAX_Onec", "StudentStatusID_Onec", student_status_code,
        "ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec",
        "PostalCode_Onec", address_house_no, address_latitude, address_longitude,
        created_by, updated_by, deleted_at, deleted_by
      )
      VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, 1, $7, $8, NULL, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $17,
        $18, $19, $20, $21, $10, $22, $23, $24, $24, NULL, NULL
      )
      ON CONFLICT (student_uuid) DO UPDATE SET
        person_uuid = EXCLUDED.person_uuid,
        "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
        "Semester_Onec" = EXCLUDED."Semester_Onec",
        "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
        "PersonID_Onec" = EXCLUDED."PersonID_Onec",
        "PrefixID_Onec" = EXCLUDED."PrefixID_Onec",
        "FirstName_Onec" = EXCLUDED."FirstName_Onec",
        "LastName_Onec" = EXCLUDED."LastName_Onec",
        "NationalityID_Onec" = EXCLUDED."NationalityID_Onec",
        "VillageNumber_Onec" = EXCLUDED."VillageNumber_Onec",
        "Street_Onec" = EXCLUDED."Street_Onec",
        "Soi_Onec" = EXCLUDED."Soi_Onec",
        "SchoolAdmissionYear_Onec" = EXCLUDED."SchoolAdmissionYear_Onec",
        "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
        "RoomID_Onec" = EXCLUDED."RoomID_Onec",
        "GPAX_Onec" = EXCLUDED."GPAX_Onec",
        "StudentStatusID_Onec" = EXCLUDED."StudentStatusID_Onec",
        student_status_code = EXCLUDED.student_status_code,
        "ProvinceNameThai_Onec" = EXCLUDED."ProvinceNameThai_Onec",
        "DistrictNameThai_Onec" = EXCLUDED."DistrictNameThai_Onec",
        "SubDistrictNameThai_Onec" = EXCLUDED."SubDistrictNameThai_Onec",
        "PostalCode_Onec" = EXCLUDED."PostalCode_Onec",
        address_house_no = EXCLUDED.address_house_no,
        address_latitude = EXCLUDED.address_latitude,
        address_longitude = EXCLUDED.address_longitude,
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
    `,
    [
      student.studentUuid,
      student.personUuid,
      ACADEMIC_YEAR,
      SEMESTER,
      student.schoolId,
      student.personIdOnec,
      student.firstName,
      student.lastName,
      NATIONALITY_THAI,
      student.houseNo,
      student.street,
      student.soi,
      student.schoolAdmissionYear,
      student.gradeId,
      student.roomId,
      student.gpax,
      student.statusCode,
      student.province,
      student.district,
      student.subDistrict,
      student.postalCode,
      student.latitude,
      student.longitude,
      actorId,
    ],
  );
}

function buildQuarantineMappedValues(row, index) {
  const [
    status,
    reasonCode,
    schoolId,
    gradeId,
    roomId,
    studentStatusCode,
    firstName,
    lastName,
    personId,
  ] = row;
  return {
    PersonID_Onec: personId,
    FirstName_Onec: firstName,
    LastName_Onec: lastName,
    SchoolID_Onec: schoolId,
    GradeLevelID_Onec: gradeId,
    RoomID_Onec: roomId,
    AcademicYear_Onec: ACADEMIC_YEAR,
    Semester_Onec: SEMESTER,
    StudentStatusID_Onec: studentStatusCode,
    student_status_code: studentStatusCode,
    GPAX_Onec: Number((2.15 + (index % 8) * 0.19).toFixed(2)),
    ProvinceNameThai_Onec:
      schoolId === 10010002 ? 'เชียงใหม่' : schoolId === 10010003 ? 'ขอนแก่น' : 'กรุงเทพมหานคร',
    DistrictNameThai_Onec:
      schoolId === 10010002
        ? 'เมืองเชียงใหม่'
        : schoolId === 10010003
          ? 'เมืองขอนแก่น'
          : 'ดอนเมือง',
    SubDistrictNameThai_Onec:
      schoolId === 10010002 ? 'สุเทพ' : schoolId === 10010003 ? 'ในเมือง' : 'สีกัน',
    PostalCode_Onec: schoolId === 10010002 ? '50200' : schoolId === 10010003 ? '40000' : '10210',
  };
}

async function seedQuarantineRows(dataSource, actorId) {
  await dataSource.query(`DELETE FROM student_import_quarantine_rows WHERE batch_id = $1::uuid`, [
    QUARANTINE_BATCH_ID,
  ]);
  await dataSource.query(`DELETE FROM student_import_batches WHERE id = $1::uuid`, [
    QUARANTINE_BATCH_ID,
  ]);
  await dataSource.query(
    `
      INSERT INTO student_import_batches (
        id, target, source_sha256, scope_snapshot, status, total_rows,
        imported_rows, quarantined_rows, completed_at, created_by, updated_by
      )
      VALUES (
        $1::uuid, 'student_term', $2, $3::jsonb, 'PARTIAL', $4, 0, $4,
        now(), $5, $5
      )
    `,
    [
      QUARANTINE_BATCH_ID,
      createHash('sha256').update(`${SEED_SOURCE}:quarantine-source`).digest('hex'),
      JSON.stringify({ seed_source: SEED_SOURCE, purpose: 'demo import review queue' }),
      QUARANTINE_ROWS.length,
      actorId,
    ],
  );

  for (const [index, row] of QUARANTINE_ROWS.entries()) {
    const [status, reasonCode, schoolId] = row;
    const mappedValues = buildQuarantineMappedValues(row, index);
    const resolvedAt = status === 'PENDING' ? null : 'now()';
    const resolutionNote =
      status === 'RESOLVED'
        ? 'แก้ไขข้อมูลตัวอย่างเรียบร้อย'
        : status === 'REJECTED'
          ? 'ปฏิเสธรายการตัวอย่างเนื่องจากข้อมูลต้นทางไม่ถูกต้อง'
          : null;
    await dataSource.query(
      `
        INSERT INTO student_import_quarantine_rows (
          batch_id, school_id, source_row_number, row_fingerprint,
          reason_code, mapped_values, status, resolved_at, resolved_by,
          resolution_note, created_by, updated_by, created_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6::jsonb, $7,
          ${resolvedAt}, $8, $9, $8, $8, now() - ($10::int * interval '5 minutes')
        )
      `,
      [
        QUARANTINE_BATCH_ID,
        schoolId === 99999998 || schoolId === 99999999 ? null : schoolId,
        index + 2,
        createHash('sha256').update(`${SEED_SOURCE}:quarantine:${index}`).digest('hex'),
        reasonCode,
        JSON.stringify(mappedValues),
        status,
        actorId,
        resolutionNote,
        QUARANTINE_ROWS.length - index,
      ],
    );
  }
}

async function seedConflictCandidates(dataSource, actorId) {
  const identifier = '9901000000012';
  const candidates = [
    {
      personUuid: deterministicUuid(`${SEED_SOURCE}:conflict-candidate:1`),
      studentUuid: deterministicUuid(`${SEED_SOURCE}:conflict-candidate:1:term`),
      firstName: 'อรณิชา',
      lastName: 'แสงแก้ว',
      gradeId: 421,
      roomId: 1,
      gpax: 3.21,
    },
    {
      personUuid: deterministicUuid(`${SEED_SOURCE}:conflict-candidate:2`),
      studentUuid: deterministicUuid(`${SEED_SOURCE}:conflict-candidate:2:term`),
      firstName: 'อรณิชา',
      lastName: 'แสนแก้ว',
      gradeId: 112,
      roomId: 1,
      gpax: 2.84,
    },
  ];

  for (const candidate of candidates) {
    await dataSource.query(
      `
        INSERT INTO student_person (
          person_uuid, identity_status, created_by, updated_by, deleted_at, deleted_by
        )
        VALUES ($1::uuid, 'NEEDS_REVIEW', $2, $2, NULL, NULL)
        ON CONFLICT (person_uuid) DO UPDATE SET
          identity_status = 'NEEDS_REVIEW',
          updated_by = EXCLUDED.updated_by,
          deleted_at = NULL,
          deleted_by = NULL
      `,
      [candidate.personUuid, actorId],
    );

    await dataSource.query(
      `
        DELETE FROM student_person_identifier
        WHERE person_uuid = $1::uuid
          AND source = $2
      `,
      [candidate.personUuid, `${SEED_SOURCE}_CONFLICT_CANDIDATE`],
    );
    await dataSource.query(
      `
        INSERT INTO student_person_identifier (
          person_uuid, identifier_type, identifier_value, identifier_normalized,
          is_primary, source, created_by, updated_by
        )
        VALUES ($1::uuid, 'NATIONAL_ID', $2, $2, TRUE, $3, $4, $4)
      `,
      [candidate.personUuid, identifier, `${SEED_SOURCE}_CONFLICT_CANDIDATE`, actorId],
    );

    await dataSource.query(
      `
        INSERT INTO student_term (
          student_uuid, person_uuid, "AcademicYear_Onec", "Semester_Onec",
          "SchoolID_Onec", "PersonID_Onec", "PrefixID_Onec", "FirstName_Onec",
          "LastName_Onec", "NationalityID_Onec", "VillageNumber_Onec",
          "Street_Onec", "Soi_Onec", "SchoolAdmissionYear_Onec",
          "GradeLevelID_Onec", "RoomID_Onec", "GPAX_Onec",
          "StudentStatusID_Onec", student_status_code,
          "ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec",
          "PostalCode_Onec", address_house_no, address_latitude, address_longitude,
          created_by, updated_by, deleted_at, deleted_by
        )
        VALUES (
          $1::uuid, $2::uuid, $3, $4, 10010002, $5, 1, $6, $7, $8,
          '14/5', 'ถนนสุเทพ', 'ซอยชมดอย 3', $9, $10, $11, $12,
          10, 10, 'เชียงใหม่', 'เมืองเชียงใหม่', 'สุเทพ', '50200',
          '14/5', 18.7944, 98.9651, $13, $13, NULL, NULL
        )
        ON CONFLICT (student_uuid) DO UPDATE SET
          person_uuid = EXCLUDED.person_uuid,
          "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
          "Semester_Onec" = EXCLUDED."Semester_Onec",
          "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
          "PersonID_Onec" = EXCLUDED."PersonID_Onec",
          "FirstName_Onec" = EXCLUDED."FirstName_Onec",
          "LastName_Onec" = EXCLUDED."LastName_Onec",
          "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
          "RoomID_Onec" = EXCLUDED."RoomID_Onec",
          "GPAX_Onec" = EXCLUDED."GPAX_Onec",
          updated_by = EXCLUDED.updated_by,
          deleted_at = NULL,
          deleted_by = NULL
      `,
      [
        candidate.studentUuid,
        candidate.personUuid,
        ACADEMIC_YEAR,
        SEMESTER,
        identifier,
        candidate.firstName,
        candidate.lastName,
        NATIONALITY_THAI,
        ACADEMIC_YEAR - 1,
        candidate.gradeId,
        candidate.roomId,
        candidate.gpax,
        actorId,
      ],
    );
  }
}

async function summarize(dataSource) {
  return await dataSource.query(
    `
      SELECT status.code, status.label_th, status.category, COUNT(term.student_uuid)::int AS seeded_count
      FROM student_status status
      LEFT JOIN student_term term
        ON term.student_status_code = status.code
       AND term.student_uuid = ANY($1::uuid[])
       AND term.deleted_at IS NULL
      WHERE status.code = ANY($2::int[])
      GROUP BY status.code, status.label_th, status.category, status.sort_order
      ORDER BY status.sort_order, status.code
    `,
    [
      STUDENTS.map(
        (row, index) =>
          buildStudent(row, index, {
            schoolsById: new Map([[row[4], { id: row[4] }]]),
            defaultSchool: { id: row[4] },
            gradesById: new Map([[row[5], { id: row[5] }]]),
            defaultGrade: { id: row[5] },
          }).studentUuid,
      ),
      [10, 20, 30, 40, 50, 90],
    ],
  );
}

async function summarizeQuarantine(dataSource) {
  return await dataSource.query(
    `
      SELECT status, COUNT(*)::int AS seeded_count
      FROM student_import_quarantine_rows
      WHERE batch_id = $1::uuid
        AND deleted_at IS NULL
      GROUP BY status
      ORDER BY status
    `,
    [QUARANTINE_BATCH_ID],
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  const actorId = await findAuditActorId(dataSource);
  if (!actorId) throw new Error('No active DEMO administrator is available for seed attribution');
  const references = await loadReferenceMaps(dataSource);
  const students = STUDENTS.map((row, index) => buildStudent(row, index, references));

  await dataSource.transaction(async (manager) => {
    await ensureDemoStatuses(manager, actorId);
    for (const student of students) {
      await upsertStudent(manager, student, actorId);
    }
    await seedConflictCandidates(manager, actorId);
    await seedQuarantineRows(manager, actorId);
  });

  const summary = await summarize(dataSource);
  console.table(summary);
  const quarantineSummary = await summarizeQuarantine(dataSource);
  console.table(quarantineSummary);
  console.log(`Seeded ${students.length} demo student-term rows from ${SEED_SOURCE}.`);
  console.log(`Seeded ${QUARANTINE_ROWS.length} demo import quarantine rows.`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

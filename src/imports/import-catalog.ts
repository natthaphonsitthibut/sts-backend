import { hasPermission, type AuthenticatedRequestUser } from '../auth';

export const IMPORT_CATALOG_VERSION = '2026-08-01' as const;

export const IMPORT_CATALOG_TARGETS = [
  'school_teacher_membership',
  'school_classroom',
  'classroom_teacher_assignment',
  'student_term',
] as const;

export type ImportCatalogTarget = (typeof IMPORT_CATALOG_TARGETS)[number];

export interface ImportCatalogField {
  key: string;
  label: string;
  required: boolean;
  aliases: readonly string[];
  referenceSource: string | null;
  valueType: 'string' | 'integer' | 'date' | 'enum';
  allowedValues?: readonly string[];
  source: 'file' | 'canonicalContext';
}

export interface ImportCatalogContextRequirement {
  key: 'schoolId' | 'schoolTermId' | 'classroomId';
  label: string;
  referenceSource: 'schools' | 'school_terms' | 'school_classrooms';
}

export interface ImportCatalogTargetDefinition {
  target: ImportCatalogTarget;
  version: typeof IMPORT_CATALOG_VERSION;
  label: string;
  capability: 'import-data' | 'import-school-roster';
  allowed: boolean;
  dependencyOrder: number;
  dependsOn: readonly ImportCatalogTarget[];
  canonicalContext: readonly ImportCatalogContextRequirement[];
  fields: readonly ImportCatalogField[];
}

const field = (
  key: string,
  label: string,
  required: boolean,
  aliases: readonly string[],
  valueType: ImportCatalogField['valueType'] = 'string',
  referenceSource: string | null = null,
  allowedValues?: readonly string[],
  source: ImportCatalogField['source'] = 'file',
): ImportCatalogField => ({
  key,
  label,
  required,
  aliases: [key, ...aliases],
  referenceSource,
  valueType,
  source,
  ...(allowedValues ? { allowedValues } : {}),
});

const SCHOOL_CONTEXT: ImportCatalogContextRequirement = {
  key: 'schoolId',
  label: 'โรงเรียน',
  referenceSource: 'schools',
};
const TERM_CONTEXT: ImportCatalogContextRequirement = {
  key: 'schoolTermId',
  label: 'ภาคเรียน',
  referenceSource: 'school_terms',
};
const CLASSROOM_CONTEXT: ImportCatalogContextRequirement = {
  key: 'classroomId',
  label: 'ห้องเรียน',
  referenceSource: 'school_classrooms',
};

const TARGET_DEFINITIONS: ReadonlyArray<Omit<ImportCatalogTargetDefinition, 'allowed'>> = [
  {
    target: 'school_teacher_membership',
    version: IMPORT_CATALOG_VERSION,
    label: 'รายชื่อครูของโรงเรียน',
    capability: 'import-school-roster',
    dependencyOrder: 10,
    dependsOn: [],
    canonicalContext: [SCHOOL_CONTEXT],
    fields: [
      field('username', 'ชื่อผู้ใช้ครู', true, ['ชื่อผู้ใช้', 'บัญชีผู้ใช้', 'บัญชีครู']),
      field(
        'startedOn',
        'วันที่เริ่มปฏิบัติงาน',
        false,
        ['startDate', 'วันที่เริ่มงาน', 'วันที่เริ่มปฏิบัติงาน'],
        'date',
      ),
    ],
  },
  {
    target: 'school_classroom',
    version: IMPORT_CATALOG_VERSION,
    label: 'ห้องเรียน',
    capability: 'import-school-roster',
    dependencyOrder: 20,
    dependsOn: ['school_teacher_membership'],
    canonicalContext: [SCHOOL_CONTEXT, TERM_CONTEXT],
    fields: [
      field(
        'gradeLevelId',
        'รหัสระดับชั้น',
        true,
        ['gradeId', 'ชั้นเรียน', 'ชั้น'],
        'integer',
        'grade_levels',
      ),
      field('roomCode', 'รหัสห้อง', true, [
        'room',
        'roomId',
        'ห้อง',
        'ห้องเรียน',
        'legacyRoom',
        'roomNumber',
        'เลขห้อง',
      ]),
      field('roomName', 'ชื่อห้อง', false, ['ชื่อห้อง', 'ชื่อห้องเรียน']),
    ],
  },
  {
    target: 'classroom_teacher_assignment',
    version: IMPORT_CATALOG_VERSION,
    label: 'การมอบหมายครูประจำห้อง',
    capability: 'import-school-roster',
    dependencyOrder: 30,
    dependsOn: ['school_teacher_membership', 'school_classroom'],
    canonicalContext: [SCHOOL_CONTEXT, TERM_CONTEXT, CLASSROOM_CONTEXT],
    fields: [
      field(
        'username',
        'ชื่อผู้ใช้ครู',
        true,
        ['ชื่อผู้ใช้', 'บัญชีผู้ใช้', 'บัญชีครู'],
        'string',
        'school_teacher_memberships',
      ),
      field(
        'assignmentKind',
        'ประเภทการมอบหมาย',
        true,
        ['kind', 'ประเภท', 'หน้าที่'],
        'enum',
        null,
        ['HOMEROOM', 'SUBJECT'],
      ),
      field('subjectId', 'รหัสวิชา', false, ['subject', 'วิชา'], 'integer', 'subjects'),
      field('effectiveOn', 'วันที่เริ่ม', false, ['startDate', 'วันที่เริ่ม'], 'date'),
      field('effectiveUntil', 'วันที่สิ้นสุด', false, ['endDate', 'วันที่สิ้นสุด'], 'date'),
    ],
  },
  {
    target: 'student_term',
    version: IMPORT_CATALOG_VERSION,
    label: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน)',
    capability: 'import-data',
    dependencyOrder: 40,
    dependsOn: ['school_classroom'],
    canonicalContext: [SCHOOL_CONTEXT, TERM_CONTEXT, CLASSROOM_CONTEXT],
    fields: [
      field('student_number', 'รหัสประจำตัวนักเรียน', false, [
        'studentNumber',
        'studentCode',
        'รหัสประจำตัวนักเรียน',
        'รหัสนักเรียน',
      ]),
      field('PersonID_Onec', 'เลขประจำตัว/เลขบัตร', true, [
        'id',
        'studentId',
        'nationalId',
        'เลขประจำตัว',
        'เลขประจำตัวประชาชน',
        'เลขบัตรประชาชน',
        'เลขบัตร',
      ]),
      field('FullName_Onec', 'ชื่อ-นามสกุล (คอลัมน์เดียว)', false, [
        'fullName',
        'ชื่อ-นามสกุล',
        'ชื่อนามสกุล',
      ]),
      field('FirstName_Onec', 'ชื่อ', false, ['firstName', 'ชื่อ']),
      field('MiddleName_Onec', 'ชื่อกลาง', false, ['middleName', 'ชื่อกลาง']),
      field('LastName_Onec', 'นามสกุล', false, ['lastName', 'นามสกุล', 'สกุล']),
      field('DepartmentID_Onec', 'รหัสหน่วยงาน', false, ['departmentId']),
      field('PassportNumber_Onec', 'เลขหนังสือเดินทาง', false, ['passportNumber']),
      field('PrefixID_Onec', 'รหัสคำนำหน้า', false, ['prefixId']),
      field('GenderID_Onec', 'รหัสเพศ', false, ['genderId']),
      field('NationalityID_Onec', 'รหัสสัญชาติ', false, ['nationalityId']),
      field('DisabilityID_Onec', 'รหัสความพิการ', false, ['disabilityId']),
      field('DisadvantageEducationID_Onec', 'รหัสความด้อยโอกาส', false, [
        'disadvantageEducationId',
      ]),
      field(
        'StudentStatusID_Onec',
        'สถานะนักเรียน',
        false,
        ['studentStatus', 'status', 'สถานะนักเรียน'],
        'integer',
        'student_status',
      ),
      field('VillageNumber_Onec', 'หมู่', false, ['villageNumber', 'หมู่']),
      field('Street_Onec', 'ถนน', false, ['street', 'ถนน']),
      field('Soi_Onec', 'ซอย', false, ['soi', 'ซอย']),
      field('Trok_Onec', 'ตรอก', false, ['trok', 'ตรอก']),
      field('SubDistrictID_Onec', 'รหัสตำบล', false, ['subDistrictId']),
      field('SchoolAdmissionYear_Onec', 'ปีที่เข้าเรียน', false, ['admissionYear'], 'integer'),
      field('GPAX_Onec', 'เกรดเฉลี่ย', false, ['gpax']),
      field(
        'AcademicYear_Onec',
        'ปีการศึกษา',
        false,
        ['academicYear', 'ปีการศึกษา', 'ปี'],
        'integer',
        'school_terms',
        undefined,
        'canonicalContext',
      ),
      field(
        'Semester_Onec',
        'ภาคเรียน',
        false,
        ['semester', 'term', 'ภาคเรียน', 'เทอม'],
        'integer',
        'school_terms',
        undefined,
        'canonicalContext',
      ),
      field(
        'SchoolID_Onec',
        'โรงเรียน',
        false,
        ['schoolId', 'รหัสโรงเรียน', 'รหัสสถานศึกษา', 'โรงเรียน'],
        'integer',
        'schools',
        undefined,
        'canonicalContext',
      ),
      field(
        'GradeLevelID_Onec',
        'ระดับชั้น',
        false,
        ['gradeId', 'grade', 'ชั้นเรียน', 'ชั้น'],
        'integer',
        'grade_levels',
        undefined,
        'canonicalContext',
      ),
      field(
        'RoomID_Onec',
        'ห้องเรียน',
        false,
        ['roomId', 'room', 'ห้องเรียน', 'ห้อง'],
        'integer',
        'school_classrooms',
        undefined,
        'canonicalContext',
      ),
    ],
  },
];

export function getImportCatalog(actor: Pick<AuthenticatedRequestUser, 'roles' | 'permissions'>): {
  version: typeof IMPORT_CATALOG_VERSION;
  targets: ImportCatalogTargetDefinition[];
} {
  return {
    version: IMPORT_CATALOG_VERSION,
    targets: TARGET_DEFINITIONS.map((target) => ({
      ...target,
      fields: target.fields.map((catalogField) => ({ ...catalogField })),
      canonicalContext: target.canonicalContext.map((context) => ({ ...context })),
      allowed: hasPermission(actor.roles, actor.permissions, target.capability),
    })),
  };
}

export function getImportTargetDefinition(
  target: string,
): Omit<ImportCatalogTargetDefinition, 'allowed'> | undefined {
  return TARGET_DEFINITIONS.find((definition) => definition.target === target);
}

export function isImportCatalogTarget(value: string): value is ImportCatalogTarget {
  return (IMPORT_CATALOG_TARGETS as readonly string[]).includes(value);
}

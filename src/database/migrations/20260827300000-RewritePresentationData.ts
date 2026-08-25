import type { MigrationInterface, QueryRunner } from 'typeorm';

const TARGET_TEACHER_COUNT = 451;
const MIN_SUPPORTED_LOCAL_TEACHER_COUNT = 446;
const LEGACY_PRESENTATION_EMAIL_DOMAIN = 'sts-demo.ac.th';
const PRESENTATION_EMAIL_DOMAIN = 'school.sts.local';
const PRESENTATION_ORIGIN_LABEL = 'ข้อมูลสำหรับการนำเสนอ';
const PLACEHOLDER_STUDENT_NAME_PATTERN = '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)';

const LOCAL_BASELINE_TEACHERS = [
  { firstName: 'ศุภกฤต', lastName: 'วงศ์พิพัฒน์', email: 'supakrit.w@school.sts.local' },
  { firstName: 'กัญญารัตน์', lastName: 'สุขสวัสดิ์', email: 'kanyarat.s@school.sts.local' },
  { firstName: 'ธีรภัทร', lastName: 'จันทร์ฉาย', email: 'theerapat.c@school.sts.local' },
  { firstName: 'อริสา', lastName: 'พูนทรัพย์', email: 'arisa.p@school.sts.local' },
  { firstName: 'ณัฐวุฒิ', lastName: 'ศรีสกุล', email: 'nattawut.s@school.sts.local' },
] as const;

type CountValue = number | string;

type PresentationBaseline = {
  teachers_total: CountValue;
  teachers_active: CountValue;
  teachers_inactive: CountValue;
  memberships_total: CountValue;
  memberships_active: CountValue;
  memberships_inactive: CountValue;
  inactive_pair_count: CountValue;
  active_membership_duplicate_groups: CountValue;
  active_teachers_without_active_membership: CountValue;
  active_memberships_for_inactive_teachers: CountValue;
  sessions_total: CountValue;
  attendance_rows_total: CountValue;
  exception_rows_total: CountValue;
  risk_profiles_total: CountValue;
  cases_total: CountValue;
  calendar_forbidden_rows: CountValue;
  placeholder_student_rows: CountValue;
  placeholder_student_count: CountValue;
  target_student_name_rows: CountValue;
  presentation_origin_rows: CountValue;
};

type InactivePair = { teacher_id: string; membership_id: string };
type TargetSchool = { school_id: number | string; started_on: string };
type InsertedTeacher = { id: string };

function asCount(value: CountValue, field: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`RewritePresentationData: invalid ${field} count`);
  }
  return count;
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`RewritePresentationData: ${message}`);
}

/**
 * Converges presentation-only identities and volumes without changing any
 * schema, API, authorization, token, or operational audit contract.
 */
export class RewritePresentationData20260827300000 implements MigrationInterface {
  name = 'RewritePresentationData20260827300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [baseline] = (await queryRunner.query(
      `
      SELECT
        (SELECT COUNT(*) FROM teachers WHERE deleted_at IS NULL) AS teachers_total,
        (SELECT COUNT(*) FROM teachers
         WHERE deleted_at IS NULL AND teacher_status = 'ACTIVE') AS teachers_active,
        (SELECT COUNT(*) FROM teachers
         WHERE deleted_at IS NULL AND teacher_status = 'INACTIVE') AS teachers_inactive,
        (SELECT COUNT(*) FROM school_teacher_memberships
         WHERE deleted_at IS NULL) AS memberships_total,
        (SELECT COUNT(*) FROM school_teacher_memberships
         WHERE deleted_at IS NULL
           AND membership_status = 'ACTIVE'
           AND ended_on IS NULL) AS memberships_active,
        (SELECT COUNT(*) FROM school_teacher_memberships
         WHERE deleted_at IS NULL AND membership_status = 'INACTIVE') AS memberships_inactive,
        (SELECT COUNT(*)
         FROM teachers teacher
         JOIN school_teacher_memberships membership
           ON membership.teacher_id = teacher.id
          AND membership.deleted_at IS NULL
         WHERE teacher.deleted_at IS NULL
           AND teacher.teacher_status = 'INACTIVE'
           AND membership.membership_status = 'INACTIVE'
           AND membership.ended_on IS NOT NULL) AS inactive_pair_count,
        (SELECT COUNT(*) FROM (
          SELECT school_id, teacher_id
          FROM school_teacher_memberships
          WHERE deleted_at IS NULL
            AND membership_status = 'ACTIVE'
            AND ended_on IS NULL
          GROUP BY school_id, teacher_id
          HAVING COUNT(*) > 1
        ) duplicate_group) AS active_membership_duplicate_groups,
        (SELECT COUNT(*)
         FROM teachers teacher
         WHERE teacher.deleted_at IS NULL
           AND teacher.teacher_status = 'ACTIVE'
           AND NOT EXISTS (
             SELECT 1
             FROM school_teacher_memberships membership
             WHERE membership.teacher_id = teacher.id
               AND membership.deleted_at IS NULL
               AND membership.membership_status = 'ACTIVE'
               AND membership.ended_on IS NULL
           )) AS active_teachers_without_active_membership,
        (SELECT COUNT(*)
         FROM school_teacher_memberships membership
         JOIN teachers teacher ON teacher.id = membership.teacher_id
         WHERE membership.deleted_at IS NULL
           AND membership.membership_status = 'ACTIVE'
           AND membership.ended_on IS NULL
           AND (teacher.deleted_at IS NOT NULL OR teacher.teacher_status <> 'ACTIVE'))
          AS active_memberships_for_inactive_teachers,
        (SELECT COUNT(*) FROM attendance_sessions WHERE deleted_at IS NULL) AS sessions_total,
        (SELECT COUNT(*) FROM attendance) AS attendance_rows_total,
        (SELECT COUNT(*) FROM attendance_exceptions WHERE deleted_at IS NULL)
          AS exception_rows_total,
        (SELECT COUNT(*) FROM student_risk_profiles) AS risk_profiles_total,
        (SELECT COUNT(*) FROM cases WHERE deleted_at IS NULL) AS cases_total,
        (SELECT COUNT(*)
         FROM school_calendar_days
         WHERE COALESCE(reason, '')
           ~* '(demo|smoke|test|sample|fake|ข้อมูลสาธิต|ข้อมูลทดสอบ)')
          AS calendar_forbidden_rows,
        (SELECT COUNT(*)
         FROM student_term
         WHERE deleted_at IS NULL
           AND CONCAT_WS(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
             ~* $1) AS placeholder_student_rows,
        (SELECT COUNT(DISTINCT student_uuid)
         FROM student_term
         WHERE deleted_at IS NULL
           AND CONCAT_WS(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
             ~* $1) AS placeholder_student_count,
        (SELECT COUNT(*)
         FROM student_term
         WHERE deleted_at IS NULL
           AND "FirstName_Onec" = 'ภาณุพงศ์'
           AND "LastName_Onec" = 'อินทร์ประเสริฐ') AS target_student_name_rows,
        (SELECT COUNT(*) FROM data_record_origins WHERE code = 'DEMO')
          AS presentation_origin_rows
    `,
      [PLACEHOLDER_STUDENT_NAME_PATTERN],
    )) as PresentationBaseline[];

    assertCondition(Boolean(baseline), 'baseline query returned no row');
    const teachersTotal = asCount(baseline.teachers_total, 'teachers_total');
    const teachersActive = asCount(baseline.teachers_active, 'teachers_active');
    const teachersInactive = asCount(baseline.teachers_inactive, 'teachers_inactive');
    const membershipsTotal = asCount(baseline.memberships_total, 'memberships_total');
    const membershipsActive = asCount(baseline.memberships_active, 'memberships_active');
    const membershipsInactive = asCount(baseline.memberships_inactive, 'memberships_inactive');
    const inactivePairCount = asCount(baseline.inactive_pair_count, 'inactive_pair_count');

    assertCondition(
      teachersTotal >= MIN_SUPPORTED_LOCAL_TEACHER_COUNT && teachersTotal <= TARGET_TEACHER_COUNT,
      `teacher baseline ${teachersTotal} is outside the production/local manifest`,
    );
    assertCondition(
      membershipsTotal === teachersTotal,
      `teacher/membership totals diverge (${teachersTotal}/${membershipsTotal})`,
    );
    assertCondition(
      teachersActive + teachersInactive === teachersTotal,
      'teacher status contains values outside ACTIVE/INACTIVE',
    );
    assertCondition(
      membershipsActive + membershipsInactive === membershipsTotal,
      'membership state is not an ACTIVE-current or INACTIVE presentation row',
    );
    assertCondition(
      teachersInactive <= 1 &&
        membershipsInactive === teachersInactive &&
        inactivePairCount === teachersInactive,
      'inactive teacher and membership are not the one-to-one presentation correction',
    );
    assertCondition(
      asCount(baseline.active_membership_duplicate_groups, 'active_membership_duplicate_groups') ===
        0,
      'duplicate active school/teacher memberships exist',
    );
    assertCondition(
      asCount(
        baseline.active_teachers_without_active_membership,
        'active_teachers_without_active_membership',
      ) === 0,
      'an active teacher has no active membership',
    );
    assertCondition(
      asCount(
        baseline.active_memberships_for_inactive_teachers,
        'active_memberships_for_inactive_teachers',
      ) === 0,
      'an active membership points to an inactive/deleted teacher',
    );
    assertCondition(
      asCount(baseline.calendar_forbidden_rows, 'calendar_forbidden_rows') === 0,
      'NormalizeAttendanceCalendarReason prerequisite has not converged',
    );
    assertCondition(
      asCount(baseline.placeholder_student_rows, 'placeholder_student_rows') === 1 &&
        asCount(baseline.placeholder_student_count, 'placeholder_student_count') === 1,
      'placeholder student predicate is not evidence-bounded to one enrollment/person',
    );
    assertCondition(
      asCount(baseline.target_student_name_rows, 'target_student_name_rows') === 0,
      'replacement student name already exists in the presentation baseline',
    );
    assertCondition(
      asCount(baseline.presentation_origin_rows, 'presentation_origin_rows') === 1,
      'DEMO provenance catalog row is missing or duplicated',
    );
    assertCondition(
      asCount(baseline.sessions_total, 'sessions_total') > 0 &&
        asCount(baseline.attendance_rows_total, 'attendance_rows_total') > 0 &&
        asCount(baseline.exception_rows_total, 'exception_rows_total') > 0 &&
        asCount(baseline.risk_profiles_total, 'risk_profiles_total') > 0 &&
        asCount(baseline.cases_total, 'cases_total') > 0,
      'presentation attendance/risk/dashboard baseline is empty',
    );

    const inactivePairs = (await queryRunner.query(`
      SELECT
        teacher.id::text AS teacher_id,
        membership.id::text AS membership_id
      FROM teachers teacher
      JOIN school_teacher_memberships membership
        ON membership.teacher_id = teacher.id
       AND membership.deleted_at IS NULL
      WHERE teacher.deleted_at IS NULL
        AND teacher.teacher_status = 'INACTIVE'
        AND membership.membership_status = 'INACTIVE'
        AND membership.ended_on IS NOT NULL
      ORDER BY teacher.id, membership.id
    `)) as InactivePair[];
    assertCondition(
      inactivePairs.length === teachersInactive,
      'inactive pair changed after the baseline assertion',
    );

    for (const pair of inactivePairs) {
      await queryRunner.query(
        `UPDATE teachers
         SET teacher_status = 'ACTIVE', updated_at = now()
         WHERE id = $1::bigint
           AND deleted_at IS NULL
           AND teacher_status = 'INACTIVE'`,
        [pair.teacher_id],
      );
      await queryRunner.query(
        `UPDATE school_teacher_memberships
         SET membership_status = 'ACTIVE', ended_on = NULL, updated_at = now()
         WHERE id = $1::bigint
           AND teacher_id = $2::bigint
           AND deleted_at IS NULL
           AND membership_status = 'INACTIVE'
           AND ended_on IS NOT NULL`,
        [pair.membership_id, pair.teacher_id],
      );
    }

    const missingTeacherCount = TARGET_TEACHER_COUNT - teachersTotal;
    if (missingTeacherCount > 0) {
      const existingSeedEmails = (await queryRunner.query(
        `SELECT LOWER(email) AS email
         FROM teachers
         WHERE deleted_at IS NULL
           AND LOWER(email) = ANY($1::text[])`,
        [LOCAL_BASELINE_TEACHERS.map((teacher) => teacher.email)],
      )) as Array<{ email: string }>;
      const existingEmailSet = new Set(existingSeedEmails.map((row) => row.email));
      const availableTeachers = LOCAL_BASELINE_TEACHERS.filter(
        (teacher) => !existingEmailSet.has(teacher.email),
      );
      assertCondition(
        availableTeachers.length >= missingTeacherCount,
        'not enough deterministic local presentation teachers remain',
      );

      const targetSchools = (await queryRunner.query(
        `
        SELECT
          school.id AS school_id,
          COALESCE(MIN(membership.started_on), CURRENT_DATE)::text AS started_on
        FROM schools school
        LEFT JOIN school_teacher_memberships membership
          ON membership.school_id = school.id
         AND membership.deleted_at IS NULL
         AND membership.membership_status = 'ACTIVE'
         AND membership.ended_on IS NULL
        WHERE school.school_status = 'ACTIVE'
        GROUP BY school.id
        ORDER BY COUNT(membership.id), school.id
        LIMIT $1
      `,
        [missingTeacherCount],
      )) as TargetSchool[];
      assertCondition(
        targetSchools.length === missingTeacherCount,
        'not enough active schools for local presentation convergence',
      );

      for (let index = 0; index < missingTeacherCount; index += 1) {
        const teacher = availableTeachers[index];
        const school = targetSchools[index];
        assertCondition(Boolean(teacher && school), 'local presentation seed selection failed');
        const [insertedTeacher] = (await queryRunner.query(
          `
          INSERT INTO teachers (
            first_name,
            last_name,
            citizen_id,
            phone,
            email,
            line_id,
            teacher_status,
            created_by,
            updated_by
          )
          VALUES ($1, $2, NULL, NULL, $3, NULL, 'ACTIVE', NULL, NULL)
          RETURNING id::text
        `,
          [teacher.firstName, teacher.lastName, teacher.email],
        )) as InsertedTeacher[];
        assertCondition(Boolean(insertedTeacher), 'teacher insert returned no identity');
        await queryRunner.query(
          `
          INSERT INTO school_teacher_memberships (
            school_id,
            teacher_id,
            membership_status,
            started_on,
            ended_on,
            created_by,
            updated_by
          )
          VALUES ($1, $2::bigint, 'ACTIVE', $3::date, NULL, NULL, NULL)
        `,
          [school.school_id, insertedTeacher.id, school.started_on],
        );
      }
    }

    const emailColumns = [
      ['users', 'email'],
      ['teachers', 'email'],
      ['task_links', 'assigned_to_email'],
      ['teacher_external_identities', 'normalized_email'],
      ['araid_identity_records', 'email_address'],
      ['student_guardian', 'email'],
      ['student_person_contact', 'email'],
    ] as const;
    for (const [table, column] of emailColumns) {
      await queryRunner.query(
        `UPDATE ${table}
         SET ${column} = LOWER(BTRIM(SPLIT_PART(${column}, '@', 1))) || '@' || $2
         WHERE LOWER(SPLIT_PART(${column}, '@', 2)) = $1`,
        [LEGACY_PRESENTATION_EMAIL_DOMAIN, PRESENTATION_EMAIL_DOMAIN],
      );
    }

    await queryRunner.query(
      `
      UPDATE student_term
      SET
        "FirstName_Onec" = 'ภาณุพงศ์',
        "MiddleName_Onec" = NULL,
        "LastName_Onec" = 'อินทร์ประเสริฐ',
        updated_at = now()
      WHERE deleted_at IS NULL
        AND CONCAT_WS(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
          ~* $1
    `,
      [PLACEHOLDER_STUDENT_NAME_PATTERN],
    );
    await queryRunner.query(
      `UPDATE data_record_origins
       SET label_th = $1, is_visible_by_default = FALSE, updated_at = now()
       WHERE code = 'DEMO'`,
      [PRESENTATION_ORIGIN_LABEL],
    );

    const [verification] = (await queryRunner.query(
      `
      SELECT
        (SELECT COUNT(*) FROM teachers WHERE deleted_at IS NULL) AS teachers_total,
        (SELECT COUNT(*) FROM teachers
         WHERE deleted_at IS NULL AND teacher_status = 'ACTIVE') AS teachers_active,
        (SELECT COUNT(*) FROM school_teacher_memberships
         WHERE deleted_at IS NULL) AS memberships_total,
        (SELECT COUNT(*) FROM school_teacher_memberships
         WHERE deleted_at IS NULL
           AND membership_status = 'ACTIVE'
           AND ended_on IS NULL) AS memberships_active,
        (SELECT COUNT(*) FROM (
          SELECT school_id, teacher_id
          FROM school_teacher_memberships
          WHERE deleted_at IS NULL
            AND membership_status = 'ACTIVE'
            AND ended_on IS NULL
          GROUP BY school_id, teacher_id
          HAVING COUNT(*) > 1
        ) duplicate_group) AS active_membership_duplicate_groups,
        (SELECT COUNT(*)
         FROM school_teacher_memberships membership
         LEFT JOIN teachers teacher ON teacher.id = membership.teacher_id
         WHERE membership.deleted_at IS NULL
           AND (
             teacher.id IS NULL
             OR teacher.deleted_at IS NOT NULL
             OR teacher.teacher_status <> 'ACTIVE'
           )) AS invalid_membership_teacher_rows,
        (SELECT COUNT(*)
         FROM users
         WHERE data_origin_code = 'AUTOMATED_TEST' AND status = 'ACTIVE')
          AS active_automated_users,
        (SELECT COUNT(*)
         FROM student_term
         WHERE deleted_at IS NULL
           AND CONCAT_WS(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
             ~* $1) AS placeholder_student_rows,
        (SELECT COUNT(*)
         FROM student_term
         WHERE deleted_at IS NULL
           AND "FirstName_Onec" = 'ภาณุพงศ์'
           AND "LastName_Onec" = 'อินทร์ประเสริฐ') AS target_student_name_rows,
        (SELECT COUNT(*)
         FROM data_record_origins
         WHERE code = 'DEMO'
           AND label_th = $2
           AND is_visible_by_default = FALSE) AS presentation_origin_rows,
        (SELECT COUNT(*) FROM attendance_sessions WHERE deleted_at IS NULL) AS sessions_total,
        (SELECT COUNT(*) FROM attendance) AS attendance_rows_total,
        (SELECT COUNT(*) FROM attendance_exceptions WHERE deleted_at IS NULL)
          AS exception_rows_total,
        (SELECT COUNT(*) FROM student_risk_profiles) AS risk_profiles_total,
        (SELECT COUNT(*) FROM cases WHERE deleted_at IS NULL) AS cases_total,
        (
          SELECT SUM(match_count) FROM (
            SELECT COUNT(*) AS match_count FROM users
            WHERE LOWER(SPLIT_PART(email, '@', 2)) = $3
            UNION ALL
            SELECT COUNT(*) FROM teachers
            WHERE LOWER(SPLIT_PART(email, '@', 2)) = $3
            UNION ALL
            SELECT COUNT(*) FROM task_links
            WHERE LOWER(SPLIT_PART(assigned_to_email, '@', 2)) = $3
            UNION ALL
            SELECT COUNT(*) FROM teacher_external_identities
            WHERE LOWER(SPLIT_PART(normalized_email, '@', 2)) = $3
            UNION ALL
            SELECT COUNT(*) FROM araid_identity_records
            WHERE LOWER(SPLIT_PART(email_address, '@', 2)) = $3
            UNION ALL
            SELECT COUNT(*) FROM student_guardian
            WHERE LOWER(SPLIT_PART(email, '@', 2)) = $3
            UNION ALL
            SELECT COUNT(*) FROM student_person_contact
            WHERE LOWER(SPLIT_PART(email, '@', 2)) = $3
          ) old_domain
        ) AS old_email_domain_rows,
        (
          SELECT SUM(match_count) FROM (
            SELECT COUNT(*) AS match_count FROM schools
            WHERE CONCAT_WS(' ', name, province, district, sub_district)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM subjects
            WHERE CONCAT_WS(' ', code, name_th)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM school_classrooms
            WHERE CONCAT_WS(' ', room_code, room_name)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM teachers
            WHERE CONCAT_WS(' ', first_name, last_name, email)
              ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM users
            WHERE data_origin_code <> 'AUTOMATED_TEST'
              AND CONCAT_WS(
                ' ', username, affiliation, "FirstName", "LastName", email, deactivation_note
              ) ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM student_term
            WHERE deleted_at IS NULL
              AND CONCAT_WS(' ', "FirstName_Onec", "MiddleName_Onec", "LastName_Onec")
                ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM task_links
            WHERE deleted_at IS NULL
              AND CONCAT_WS(
                ' ', assigned_to_name, assigned_to_first_name, assigned_to_last_name,
                assigned_to_email, subject, assignment_note, cancel_reason
              ) ~* '(^|[^a-z])(demo|smoke|test|sample|fake)([^a-z]|$)'
            UNION ALL
            SELECT COUNT(*) FROM school_calendar_days
            WHERE COALESCE(reason, '')
              ~* '(demo|smoke|test|sample|fake|ข้อมูลสาธิต|ข้อมูลทดสอบ)'
          ) forbidden_surface
        ) AS forbidden_business_surface_rows
    `,
      [
        PLACEHOLDER_STUDENT_NAME_PATTERN,
        PRESENTATION_ORIGIN_LABEL,
        LEGACY_PRESENTATION_EMAIL_DOMAIN,
      ],
    )) as Array<Record<string, CountValue>>;

    assertCondition(Boolean(verification), 'verification query returned no row');
    assertCondition(
      asCount(verification.teachers_total, 'verified teachers_total') === TARGET_TEACHER_COUNT &&
        asCount(verification.teachers_active, 'verified teachers_active') ===
          TARGET_TEACHER_COUNT &&
        asCount(verification.memberships_total, 'verified memberships_total') ===
          TARGET_TEACHER_COUNT &&
        asCount(verification.memberships_active, 'verified memberships_active') ===
          TARGET_TEACHER_COUNT,
      'teacher/membership target did not converge to 451 active rows',
    );
    for (const field of [
      'active_membership_duplicate_groups',
      'invalid_membership_teacher_rows',
      'active_automated_users',
      'placeholder_student_rows',
      'old_email_domain_rows',
      'forbidden_business_surface_rows',
    ] as const) {
      assertCondition(
        asCount(verification[field], field) === 0,
        `${field} did not reconcile to zero`,
      );
    }
    assertCondition(
      asCount(verification.target_student_name_rows, 'verified target_student_name_rows') === 1,
      'replacement student name did not reconcile to one enrollment',
    );
    assertCondition(
      asCount(verification.presentation_origin_rows, 'verified presentation_origin_rows') === 1,
      'presentation provenance catalog did not converge',
    );

    const unchangedMetrics = [
      'sessions_total',
      'attendance_rows_total',
      'exception_rows_total',
      'risk_profiles_total',
      'cases_total',
    ] as const;
    for (const field of unchangedMetrics) {
      assertCondition(
        asCount(verification[field], `verified ${field}`) === asCount(baseline[field], field),
        `${field} changed during presentation rewrite`,
      );
    }
  }

  /**
   * Restoring banned presentation markers or an intentionally inactive teacher
   * would be a data regression. Roll back application code instead; this
   * presentation-only correction remains in place and stores no backup table.
   */
  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'RewritePresentationData is forward-only: restoring obsolete presentation identities is unsafe',
      ),
    );
  }
}

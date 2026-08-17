require('dotenv/config');

const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const xlsx = require('xlsx');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');
const SCHOOL_NAME_LIKE = '%ดรุณ%';

/**
 * Fills ประวัติการมอบหมาย and ประวัติการนำเข้าไฟล์ for every room of โรงเรียนดรุณ
 * by driving the real endpoints: delegations are issued (and some revoked)
 * through the delegation API, and each import is a real spreadsheet of that
 * room's own students posted to the import API, so the history rows carry real
 * grants, real files and real audit entries.
 */
async function main() {
  await appDataSource.initialize();
  const runner = appDataSource.createQueryRunner();
  await runner.connect();

  const [school] = await runner.query(
    `SELECT id, name FROM schools WHERE name ILIKE $1 AND school_status = 'ACTIVE' LIMIT 1`,
    [SCHOOL_NAME_LIKE],
  );
  if (!school) throw new Error('ไม่พบโรงเรียนดรุณ');

  const [admin] = await runner.query(
    `
      SELECT id, username FROM users
      WHERE status = 'ACTIVE'
        AND permissions::text ILIKE '%manage-teacher-access%'
        AND (data_scope->>'global' = 'true' OR data_scope->'school_ids' @> to_jsonb($1::int))
      ORDER BY id
      LIMIT 1
    `,
    [Number(school.id)],
  );
  if (!admin) throw new Error('ไม่พบผู้ใช้ที่มีสิทธิ์ออกลิงก์มอบหมายในโรงเรียนนี้');

  const classrooms = await runner.query(
    `
      SELECT
        classroom.id::text AS classroom_id,
        classroom.school_term_id::text AS school_term_id,
        grade.label AS grade_label,
        classroom.room_code,
        homeroom.id::text AS assignment_id,
        homeroom.teacher_membership_id::text AS owner_membership_id,
        (
          SELECT membership.id
          FROM school_teacher_memberships membership
          JOIN teachers teacher ON teacher.id = membership.teacher_id
          WHERE membership.school_id = classroom.school_id
            AND membership.id <> homeroom.teacher_membership_id
            AND membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
            AND teacher.teacher_status = 'ACTIVE'
          ORDER BY membership.id
          LIMIT 1
        )::text AS recipient_membership_id
      FROM school_classrooms classroom
      JOIN school_terms term ON term.id = classroom.school_term_id
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      JOIN classroom_teacher_assignments homeroom
        ON homeroom.classroom_id = classroom.id
       AND homeroom.assignment_kind = 'HOMEROOM'
       AND homeroom.assignment_status = 'ACTIVE'
       AND homeroom.deleted_at IS NULL
      WHERE classroom.school_id = $1
        AND classroom.classroom_status = 'ACTIVE'
        AND classroom.deleted_at IS NULL
        AND term.status = 'ACTIVE'
        AND term.deleted_at IS NULL
      ORDER BY classroom.grade_level_id, classroom.room_code
    `,
    [Number(school.id)],
  );
  const [{ day: today }] = await runner.query(
    `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day`,
  );
  const [before] = await runner.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM teacher_access_attendance_assignments delegated
          WHERE delegated.school_id = $1) AS delegations,
        (SELECT COUNT(*)::int FROM attendance_import_files import_file
          WHERE import_file.school_id = $1 AND import_file.deleted_at IS NULL) AS imports
    `,
    [Number(school.id)],
  );

  console.log(`${school.name} · ${classrooms.length} ห้อง`);
  console.log(`delegations/imports ที่มีอยู่ : ${before.delegations} / ${before.imports}`);

  if (AUDIT_ONLY || classrooms.length === 0) {
    console.log('audit-only: no changes written');
    await runner.release();
    await appDataSource.destroy();
    return;
  }

  const students = new Map();
  for (const room of classrooms) {
    const rows = await runner.query(
      `
        SELECT student_number, "FirstName_Onec" AS first_name, "LastName_Onec" AS last_name
        FROM student_term
        WHERE classroom_id = $1 AND deleted_at IS NULL
        ORDER BY student_number NULLS LAST
        LIMIT 40
      `,
      [Number(room.classroom_id)],
    );
    students.set(room.classroom_id, rows);
  }
  await runner.release();

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0);
  const baseUrl = await app.getUrl();
  let cookie;
  app.get(SessionCookieService).setSession(
    {
      cookie: (name, value) => {
        cookie = `${name}=${value}`;
      },
    },
    Number(admin.id),
  );

  async function post(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 140)}`);
    return text ? JSON.parse(text) : null;
  }

  async function postForm(path, form) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 140)}`);
    return text ? JSON.parse(text) : null;
  }

  /** A spreadsheet in the shape the import screen accepts. */
  function buildWorkbook(room, roster) {
    const statuses = ['มา', 'มา', 'มา', 'สาย', 'ลา', 'ขาด'];
    const rows = roster.map((student, index) => ({
      รหัสประจำตัว: student.student_number ?? '',
      'ชื่อ-นามสกุล': `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim(),
      สถานะ: statuses[index % statuses.length],
    }));
    const sheet = xlsx.utils.json_to_sheet(rows);
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, sheet, 'เช็กชื่อ');
    return {
      buffer: xlsx.write(book, { bookType: 'xlsx', type: 'buffer' }),
      rowCount: rows.length,
      appliedCount: rows.filter((row) => row.รหัสประจำตัว).length,
    };
  }

  const states = ['PENDING', 'REVOKED', 'EXPIRED'];
  let delegations = 0;
  let imports = 0;
  for (const [index, room] of classrooms.entries()) {
    const label = `${room.grade_label}/${room.room_code}`;
    const state = states[index % states.length];
    if (room.recipient_membership_id) {
      const window =
        state === 'EXPIRED'
          ? { startsAt: '07:30', endsAt: '08:30' }
          : { startsAt: '09:00', endsAt: '23:59' };
      try {
        const issued = await post('/api/teacher-access-grants/attendance-delegations', {
          schoolId: Number(school.id),
          schoolTermId: Number(room.school_term_id),
          teacherMembershipId: Number(room.recipient_membership_id),
          assignmentId: Number(room.assignment_id),
          attendanceDate: today,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
        });
        delegations += 1;
        if (state === 'REVOKED') {
          await post(
            `/api/teacher-access-grants/attendance-delegations/${issued.data.id}/revoke`,
            {},
          );
        }
      } catch (error) {
        console.log(`  ${label} delegation: ${String(error.message).slice(0, 90)}`);
      }
    }

    const roster = students.get(room.classroom_id) ?? [];
    if (roster.length > 0) {
      const workbook = buildWorkbook(room, roster);
      const form = new FormData();
      form.append(
        'file',
        new Blob([workbook.buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `เช็กชื่อ-${label.replace('/', '-')}-${today}.xlsx`,
      );
      // School and term come from the classroom on the server side.
      form.append('classroomId', String(room.classroom_id));
      form.append('attendanceDate', today);
      form.append('fileName', `เช็กชื่อ-${label.replace('/', '-')}-${today}.xlsx`);
      form.append('rowCount', String(workbook.rowCount));
      form.append('appliedCount', String(workbook.appliedCount));
      try {
        await postForm('/api/attendance/imports', form);
        imports += 1;
      } catch (error) {
        console.log(`  ${label} import: ${String(error.message).slice(0, 90)}`);
      }
    }
  }

  await app.close();
  await appDataSource.destroy();
  console.log(`issued ${delegations} delegation(s) and recorded ${imports} import(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

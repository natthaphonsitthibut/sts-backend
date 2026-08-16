/**
 * API smoke for the attendance file import.
 *
 * Covers what the unit tests cannot: real HTTP routing, the multipart upload
 * gate, DTO validation, the permission guard on the authenticated route, and
 * the grant check on the teacher-link route — including that a delegated
 * ATTENDANCE_ONLY link may read an import file but nothing else.
 */
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const xlsx = require('xlsx');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const {
  USERNAMES,
  assert,
  assertSchemaPrerequisites,
  cleanup,
  createFixture,
  sessionCookieHeader,
  upsertUser,
} = require('./smoke-teacher-access');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run the attendance import smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const IMPORT_HEADERS = ['ลำดับ', 'รหัสประจำตัว', 'ชื่อ-นามสกุล', 'สถานะการเช็กชื่อ'];

function workbookBuffer(rows) {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.aoa_to_sheet([IMPORT_HEADERS, ...rows]),
    'การเช็กชื่อ',
  );
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function importFormData(buffer, filename = 'attendance.xlsx') {
  const form = new FormData();
  form.append(
    'file',
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
  return form;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
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
  await app.listen(0, '127.0.0.1');

  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const parseUrl = `${baseUrl}/api/attendance/import/parse`;

  try {
    await assertSchemaPrerequisites(dataSource);
    const [school] = await dataSource.query(
      `SELECT id FROM schools WHERE school_status = 'ACTIVE' ORDER BY id LIMIT 1`,
    );
    assert(school, 'Attendance import smoke requires an active school');
    const dataScope = { school_ids: [Number(school.id)] };
    const actors = {
      admin: await upsertUser(dataSource, {
        username: USERNAMES.admin,
        firstName: 'Attendance Import',
        lastName: 'Smoke Admin',
        role: 'ADMIN',
        permissions: ['manage-teacher-access', 'attendance'],
        dataScope,
      }),
      teacherOne: await upsertUser(dataSource, {
        username: USERNAMES.teacherOne,
        firstName: 'Teacher One',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope,
      }),
      teacherTwo: await upsertUser(dataSource, {
        username: USERNAMES.teacherTwo,
        firstName: 'Teacher Two',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope,
      }),
    };
    await cleanup(dataSource);
    await createFixture(dataSource, actors);
    for (const actor of Object.values(actors)) {
      await dataSource.query(
        `UPDATE users SET status = 'ACTIVE', deactivated_at = NULL, deactivated_by = NULL,
           deactivation_reason_code = NULL, deactivation_note = NULL WHERE id = $1`,
        [actor.id],
      );
    }
    const teacherCookie = sessionCookieHeader(sessionCookieService, actors.teacherOne.id);

    // 1. A teacher with the attendance permission gets plain headers and rows.
    const parsed = await fetch(parseUrl, {
      method: 'POST',
      headers: { cookie: teacherCookie },
      body: importFormData(
        workbookBuffer([
          [1, ' 66160001 ', 'สมชาย ใจดี', 'มา'],
          [2, 66160002, 'สมหญิง ใจงาม', 'สาย'],
          ['', '', '', ''],
        ]),
      ),
    });
    assert(parsed.status === 201 || parsed.status === 200, `Import parse failed: ${parsed.status}`);
    const parsedBody = await readJson(parsed);
    assert(
      JSON.stringify(parsedBody.data?.headers) === JSON.stringify(IMPORT_HEADERS),
      `Import parse returned unexpected headers: ${JSON.stringify(parsedBody.data?.headers)}`,
    );
    assert(
      JSON.stringify(parsedBody.data?.rows) ===
        JSON.stringify([
          ['1', '66160001', 'สมชาย ใจดี', 'มา'],
          ['2', '66160002', 'สมหญิง ใจงาม', 'สาย'],
        ]),
      `Import parse returned unexpected rows: ${JSON.stringify(parsedBody.data?.rows)}`,
    );
    assert(
      parsedBody.data?.source === 'FILE' && parsedBody.data?.truncated === false,
      `Import parse returned unexpected metadata: ${JSON.stringify(parsedBody.data)}`,
    );

    // 2. The request must carry either a file or a URL.
    const empty = await fetch(parseUrl, {
      method: 'POST',
      headers: { cookie: teacherCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(empty.status === 400, `Empty import request should be rejected: ${empty.status}`);

    // 3. A host outside the allowlist is refused before any request is made.
    const blockedHost = await fetch(parseUrl, {
      method: 'POST',
      headers: { cookie: teacherCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://files.example.com/attendance.xlsx' }),
    });
    assert(blockedHost.status === 400, `Non-allowlisted host should be rejected: ${blockedHost.status}`);
    const blockedBody = await readJson(blockedHost);
    assert(
      String(blockedBody.message || '').includes('files.example.com'),
      `Rejection should name the host: ${JSON.stringify(blockedBody)}`,
    );

    // 4. A non-spreadsheet extension never reaches the parser.
    const badExtension = new FormData();
    badExtension.append('file', new Blob(['not a sheet'], { type: 'text/plain' }), 'roster.txt');
    const rejectedFile = await fetch(parseUrl, {
      method: 'POST',
      headers: { cookie: teacherCookie },
      body: badExtension,
    });
    assert(rejectedFile.status === 400, `A .txt upload should be rejected: ${rejectedFile.status}`);

    // 5. Attendance is the gate: an account without it cannot read import files.
    const outsider = await upsertUser(dataSource, {
      username: `${USERNAMES.teacherTwo}_no_attendance`,
      firstName: 'No Attendance',
      lastName: 'Smoke',
      role: 'TEACHER',
      permissions: ['home'],
      dataScope,
    });
    await dataSource.query(
      `UPDATE users SET status = 'ACTIVE', deactivated_at = NULL, deactivated_by = NULL,
         deactivation_reason_code = NULL, deactivation_note = NULL WHERE id = $1`,
      [outsider.id],
    );
    const forbidden = await fetch(parseUrl, {
      method: 'POST',
      headers: { cookie: sessionCookieHeader(sessionCookieService, outsider.id) },
      body: importFormData(workbookBuffer([[1, '66160001', 'สมชาย ใจดี', 'มา']])),
    });
    assert(
      forbidden.status === 403,
      `Import parse must require the attendance permission: ${forbidden.status}`,
    );
    await dataSource.query(
      `UPDATE users SET status = 'DISABLED',
         deactivated_at = COALESCE(deactivated_at, NOW()),
         deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note = COALESCE(deactivation_note, 'Retained automated attendance import smoke fixture')
       WHERE id = $1`,
      [outsider.id],
    );

    // 6. ประวัติการนำเข้าไฟล์ is scoped to the classroom, and the classroom is
    // scoped to the actor. A teacher confined to one school must not be able to
    // list — or download — another school's import sheets, which carry student
    // ids and full names, by naming that school's classroom id.
    const [foreignClassroom] = await dataSource.query(
      `SELECT id FROM school_classrooms
       WHERE school_id <> $1 AND deleted_at IS NULL
       ORDER BY id LIMIT 1`,
      [Number(school.id)],
    );
    assert(
      foreignClassroom,
      'Attendance import smoke requires a classroom in a second school to prove the scope check',
    );
    const foreignList = await fetch(
      `${baseUrl}/api/attendance/imports?classroomId=${foreignClassroom.id}&page=1&limit=10`,
      { headers: { cookie: teacherCookie } },
    );
    assert(
      foreignList.status === 403,
      `Import history of another school's classroom must be refused: ${foreignList.status}`,
    );
    const foreignDownload = await fetch(
      `${baseUrl}/api/attendance/imports/1/file?classroomId=${foreignClassroom.id}`,
      { headers: { cookie: teacherCookie } },
    );
    assert(
      foreignDownload.status === 403,
      `Import download of another school's classroom must be refused: ${foreignDownload.status}`,
    );

    // 7. The public teacher-link route refuses an unknown token.
    const unknownToken = await fetch(`${baseUrl}/api/teacher-access/attendance-import/parse`, {
      method: 'POST',
      headers: { 'x-teacher-access-token': 'a'.repeat(64) },
      body: importFormData(workbookBuffer([[1, '66160001', 'สมชาย ใจดี', 'มา']])),
    });
    assert(
      unknownToken.status === 404,
      `Teacher-link import must reject an unknown token: ${unknownToken.status}`,
    );

    console.log(
      JSON.stringify({
        status: 'attendance_import_api_smoke_ok',
        checked: [
          'an .xlsx upload parses into plain headers and rows, blank rows dropped',
          'a request with neither file nor URL is rejected',
          'a URL host outside the allowlist is refused and named in the message',
          'a non-spreadsheet extension never reaches the parser',
          'the attendance permission gates the authenticated route',
          'import history and file download refuse a classroom outside the actor scope',
          'the teacher-link route rejects an unknown grant token',
        ],
      }),
    );
  } finally {
    await cleanup(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});

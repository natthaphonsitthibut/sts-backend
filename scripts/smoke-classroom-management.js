const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run classroom management smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
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
  const passwordService = app.get(PasswordService);
  const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = 'classroom_mgmt_smoke_admin';
  const password = `Admin-${suffix}-Password`;
  let userId = null;
  let createdId = null;

  async function request(method, path, expectedStatus, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await parseJsonResponse(response);
    assert(
      response.status === expectedStatus,
      `${method} ${path}: expected ${expectedStatus}, received ${response.status} (${JSON.stringify(payload)})`,
    );
    return { response, payload };
  }

  try {
    // Anchor on an existing term that already has classrooms (and one with students
    // for the delete guard case).
    const [term] = await dataSource.query(`
      SELECT t.id, t.school_id
      FROM school_terms t
      JOIN school_classrooms c ON c.school_term_id = t.id AND c.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
      GROUP BY t.id, t.school_id
      ORDER BY t.academic_year DESC, t.semester DESC
      LIMIT 1
    `);
    assert(term, 'Smoke DB has no term with classrooms');
    const [populated] = await dataSource.query(
      `
      SELECT c.id
      FROM school_classrooms c
      JOIN student_term s ON s.classroom_id = c.id AND s.deleted_at IS NULL
      WHERE c.school_term_id = $1 AND c.deleted_at IS NULL
      GROUP BY c.id LIMIT 1
      `,
      [term.id],
    );
    const [grade] = await dataSource.query(
      `SELECT id FROM grade_levels ORDER BY id LIMIT 1`,
    );

    const passwordHash = await passwordService.hash(password);
    const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
      username,
    ]);
    if (existing) {
      userId = existing.id;
      await dataSource.query(
        `UPDATE users SET password = $2, status = 'ACTIVE', role = 'ADMIN',
           permissions = $3::jsonb, data_scope = $4::jsonb, must_change_password = FALSE
         WHERE id = $1`,
        [
          userId,
          passwordHash,
          JSON.stringify(['manage-school-structure']),
          JSON.stringify({ school_ids: [term.school_id] }),
        ],
      );
    } else {
      const [row] = await dataSource.query(
        `INSERT INTO users (
           username, password, "FirstName", "LastName", status, permissions, role,
           data_scope, must_change_password, data_origin_code
         ) VALUES ($1, $2, 'สมเกียรติ', 'ตรวจระบบ', 'ACTIVE', $3::jsonb, 'ADMIN',
           $4::jsonb, FALSE, 'AUTOMATED_TEST')
         RETURNING id`,
        [
          username,
          passwordHash,
          JSON.stringify(['manage-school-structure']),
          JSON.stringify({ school_ids: [term.school_id] }),
        ],
      );
      userId = row.id;
    }

    const login = await request('POST', '/api/users/login', 201, {
      body: { username, password },
    });
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    const authed = { headers: { cookie } };

    // create → list shows it (with homeroomTeacherName field) → edit → delete
    const roomCode = String(1_500_000_000 + (Date.now() % 500_000_000));
    const updatedRoomCode = String(Number(roomCode) + 1);
    const created = await request('POST', '/api/school-structure/classrooms', 201, {
      ...authed,
      body: {
        schoolTermId: Number(term.id),
        gradeLevelId: Number(grade.id),
        roomCode,
      },
    });
    createdId = created.payload.data.id;

    const listed = await request(
      'GET',
      `/api/school-structure/classrooms?schoolId=${term.school_id}&termId=${term.id}&classroomId=${createdId}&page=1&limit=10&sortBy=grade&sortDirection=asc`,
      200,
      authed,
    );
    assert(listed.payload.data.length === 1, 'Created classroom missing from list');
    assert(
      'homeroomTeacherName' in listed.payload.data[0],
      'List row does not expose homeroomTeacherName',
    );

    const updated = await request(
      'PATCH',
      `/api/school-structure/classrooms/${createdId}`,
      200,
      {
        ...authed,
        body: { roomCode: updatedRoomCode, roomName: 'ห้องทดสอบระบบ' },
      },
    );
    assert(updated.payload.data.roomCode === updatedRoomCode, 'roomCode did not update');
    assert(
      updated.payload.data.legacyRoomNumber === Number(updatedRoomCode),
      'legacyRoomNumber was not derived from roomCode',
    );

    if (populated) {
      await request('DELETE', `/api/school-structure/classrooms/${populated.id}`, 409, authed);
    }
    await request('DELETE', `/api/school-structure/classrooms/${createdId}`, 200, authed);
    const gone = await request(
      'GET',
      `/api/school-structure/classrooms?schoolId=${term.school_id}&termId=${term.id}&classroomId=${createdId}&page=1&limit=10&sortBy=grade&sortDirection=asc`,
      200,
      authed,
    );
    assert(gone.payload.data.length === 0, 'Deleted classroom still listed');

    console.log('SMOKE OK: classroom create → list(homeroom field) → edit → guarded delete');
  } finally {
    // The fixture admin stays for reuse (audit_log is append-only); only the
    // classroom row this run created is removed, soft-deleted or not.
    if (createdId) {
      await dataSource.query(`DELETE FROM school_classrooms WHERE id = $1`, [createdId]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

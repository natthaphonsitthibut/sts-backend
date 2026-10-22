/**
 * Calls every authenticated GET endpoint once against a local database and lets
 * capture-preload.js record the responses as documentation examples.
 *   DB_NAME=sts OPENAPI_CAPTURE_FILE=out.jsonl node -r ./scripts/openapi/capture-preload.js \
 *     scripts/openapi/crawl-get-examples.js openapi/openapi.json
 * Uses a session for an existing global ADMIN user (minted locally, no password).
 * Read-only: only GET requests are sent.
 */
const fs = require('fs');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { AppModule } = require('../../dist/app.module');
const { AppExceptionFilter } = require('../../dist/common/filters/app-exception.filter');
const { createValidationException } = require('../../dist/common/validation/validation-exception.factory');
const { authConfig } = require('../../dist/config/auth.config');

const SKIP = [/^\/uploads\//, /^\/api\/check-in\//, /^\/api\/classroom\//, /\{token\}/, /\/photo$/, /\/cover$/, /\/download$/,
  /^\/api\/uploads\//, /\/google\//, /^\/api\/line\/link/, /araid\/session/];

async function main() {
  const spec = JSON.parse(fs.readFileSync(process.argv[2] || 'openapi/openapi.json', 'utf8'));
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: false,
    transformOptions: { enableImplicitConversion: true }, exceptionFactory: createValidationException }));
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const db = app.get(DataSource);
  const jwt = app.get(JwtService);
  const auth = app.get(authConfig.KEY);
  const q = async (sql) => {
    try {
      return (await db.query(sql)).map((r) => Object.values(r)[0]).filter((v) => v !== null && v !== undefined);
    } catch (error) {
      process.stderr.write(`query skipped: ${error.message}\n`);
      return [];
    }
  };
  const [adminId] = await q(`SELECT u.id FROM users u WHERE u.role = 'ADMIN' AND u.status = 'ACTIVE' AND u.data_scope @> '{"global": true}'::jsonb ORDER BY u.id LIMIT 1`);
  const cookie = `${auth.cookieName}=${encodeURIComponent(jwt.sign({ sub: adminId }))}`;
  const caseIds = await q(`SELECT c.id FROM cases c WHERE c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM case_referrals r WHERE r.case_id = c.id) ORDER BY c.id DESC LIMIT 3`);
  const cand = {
    recordId: await q(`SELECT id FROM araid_identity_records ORDER BY updated_at DESC LIMIT 2`),
    id: [],
    studentId: await q(`SELECT c.student_uuid FROM cases c WHERE c.deleted_at IS NULL ORDER BY c.id DESC LIMIT 3`),
    taskId: await q(`SELECT id FROM tasks ORDER BY id DESC LIMIT 3`),
    linkId: await q(`SELECT id FROM task_links ORDER BY created_at DESC LIMIT 3`),
    caseId: caseIds,
    referralId: caseIds.length ? await q(`SELECT id FROM case_referrals WHERE case_id = ${Number(caseIds[0])} ORDER BY referred_at DESC LIMIT 2`) : [],
    key: await q(`SELECT setting_key FROM system_settings ORDER BY setting_key LIMIT 2`),
    catalog: ['absence-reasons', 'assistance-measures', 'referral-agency-kinds'],
    code: await q(`SELECT code FROM student_status ORDER BY code LIMIT 2`),
    name: await q(`SELECT "FirstName_Onec" FROM student_term s JOIN cases c ON c.student_uuid = s.student_uuid ORDER BY c.id DESC LIMIT 2`),
    schoolSubjectId: await q(`SELECT id FROM school_subjects ORDER BY id DESC LIMIT 2`),
    classroomId: await q(`SELECT classroom_id FROM classroom_subjects ORDER BY classroom_id DESC LIMIT 2`),
    jobId: await q(`SELECT id FROM data_export_job ORDER BY created_at DESC LIMIT 2`),
    studentTermId: await q(`SELECT student_term_id FROM classroom_student_comments ORDER BY id DESC LIMIT 2`),
  };
  const idByPath = [
    [/^\/api\/audit-log\//, `SELECT id FROM audit_log ORDER BY id DESC LIMIT 2`],
    [/^\/api\/users\//, `SELECT id FROM users WHERE role <> 'ADMIN' AND status = 'ACTIVE' ORDER BY id LIMIT 2`],
    [/^\/api\/students\/attendance\//, `SELECT c.student_uuid FROM cases c ORDER BY c.id DESC LIMIT 2`],
    [/^\/api\/students\//, `SELECT c.student_uuid FROM cases c ORDER BY c.id DESC LIMIT 2`],
    [/^\/api\/imports\/quarantine\//, `SELECT id FROM student_import_quarantine_rows ORDER BY id DESC LIMIT 2`],
    [/^\/api\/teachers\//, `SELECT id FROM teachers ORDER BY id LIMIT 2`],
    [/^\/api\/teacher-profiles\//, `SELECT id FROM teachers ORDER BY id LIMIT 2`],
    [/^\/api\/classroom-attendance-links\//, `SELECT id FROM classroom_attendance_links ORDER BY id DESC LIMIT 2`],
    [/^\/api\/nl-query\/conversations\//, `SELECT id FROM nl_conversation ORDER BY updated_at DESC LIMIT 2`],
  ];
  const [school] = await db.query(`SELECT s.id, s.province, s.district, s.sub_district FROM schools s
    WHERE EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.school_id = s.id) ORDER BY (SELECT count(*) FROM cases c WHERE c.school_id = s.id) DESC LIMIT 1`);
  const [term] = await q(`SELECT id FROM school_terms WHERE school_id = ${Number(school.id)} AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`);
  const [room] = await db.query(`SELECT c.id, c.grade_level_id FROM school_classrooms c WHERE c.school_id = ${Number(school.id)} AND c.school_term_id = ${Number(term)}
    AND EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.classroom_id = c.id) ORDER BY c.id LIMIT 1`);
  const [subjectOffer] = await q(`SELECT id FROM classroom_subjects WHERE classroom_id = ${Number(room.id)} ORDER BY id LIMIT 1`);
  const [student] = await q(`SELECT student_uuid FROM student_term WHERE classroom_id = ${Number(room.id)} ORDER BY student_uuid LIMIT 1`);
  const [lastDate] = await q(`SELECT to_char(max(attendance_date), 'YYYY-MM-DD') FROM attendance_sessions WHERE classroom_id = ${Number(room.id)}`);
  const queryDefaults = {
    domain: 'all', schoolId: school.id, termId: term, schoolTermId: term, gradeLevelId: room.grade_level_id, grade: room.grade_level_id,
    classroomId: room.id, classroomSubjectId: subjectOffer, studentId: student, date: lastDate, view: 'DAILY',
    province: school.province, district: school.district, address: `${school.sub_district} ${school.district} ${school.province}`,
    page: 1, limit: 20,
  };
  const results = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!item.get || SKIP.some((r) => r.test(path))) continue;
    const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    let values = {};
    for (const n of names) {
      let list = cand[n] || [];
      if (n === 'id') {
        const hit = idByPath.find(([re]) => re.test(path));
        list = hit ? await q(hit[1]).catch(() => []) : [];
      }
      values[n] = list;
    }
    const combos = names.length === 0 ? [{}] : (values[names[0]] || []).flatMap((v) =>
      names.length === 1 ? [{ [names[0]]: v }] : (values[names[1]] || []).map((w) => ({ [names[0]]: v, [names[1]]: w })));
    let status = 'no-params';
    for (const combo of combos) {
      const query = new URLSearchParams();
      for (const p of item.get.parameters || []) {
        if (p.in === 'query' && p.required && queryDefaults[p.name] !== undefined) query.set(p.name, String(queryDefaults[p.name]));
      }
      const qs = query.toString();
      const url = path.replace(/\{(\w+)\}/g, (_, n) => encodeURIComponent(String(combo[n]))) + (qs ? `?${qs}` : '');
      const res = await fetch(`${base}${url}`, { headers: { cookie } });
      await res.arrayBuffer();
      status = res.status;
      if (status < 400) break;
    }
    results.push(`${status}\tGET ${path}`);
  }
  process.stdout.write(results.join('\n') + '\n');
  await app.close();
  process.exit(0);
}
main().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });

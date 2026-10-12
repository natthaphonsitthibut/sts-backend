/** Isolated PostgreSQL/API/Chrome regression for term edits and report filters.
 * Source DB is cloned; all mutations happen only in a disposable *_smoke DB.
 * No credentials, cookies, or student names are printed.
 */
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const { SchedulerRegistry } = require('@nestjs/schedule');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AuditLogService } = require('../dist/audit-log/audit-log.service');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const {
  PreserveEnrollmentStructureOnTermEdit20261011100000: Migration,
} = require('../dist/database/migrations/20261011100000-PreserveEnrollmentStructureOnTermEdit');
const { PAGE_SIZES } = require('../dist/common/pagination/pagination.util');
const {
  DeferDraftEnrollmentResolution20261011103000: DraftMigration,
} = require('../dist/database/migrations/20261011103000-DeferDraftEnrollmentResolution');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');
const verifyDbName = 'sts_term_ui_verify_smoke';
const frontendUrl = 'http://127.0.0.1:5178';
if (
  process.env.NODE_ENV === 'production' ||
  process.env.DB_NAME !== verifyDbName ||
  process.env.DB_HOST !== '127.0.0.1'
) {
  throw new Error(`Run with DB_HOST=127.0.0.1 DB_SSL=false DB_NAME=${verifyDbName}`);
}
function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      'sts-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}
async function main() {
  let app, frontend, chrome, db;
  let cloned = false;
  try {
    assert(
      !psql(`SELECT 1 FROM pg_database WHERE datname='${verifyDbName}'`).trim(),
      'Disposable verification database already exists; refusing to replace it',
    );
    psql(`CREATE DATABASE ${verifyDbName} TEMPLATE sts_smoke`);
    cloned = true;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RiskProfileService)
      .useValue({
        enqueueFull: async () => {},
        enqueueStudents: async () => {},
        enqueueStudent: async () => {},
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    app.enableCors({ origin: frontendUrl, credentials: true });
    await app.init();
    app
      .get(SchedulerRegistry)
      .getCronJobs()
      .forEach((job) => job.stop());
    db = app.get(DataSource);
    const migration = new Migration();
    const runner = db.createQueryRunner();
    await runner.connect();
    await migration.up(runner);
    await migration.down(runner);
    await migration.up(runner);
    const draftMigration = new DraftMigration();
    await draftMigration.up(runner);
    await draftMigration.down(runner);
    await draftMigration.up(runner);
    await runner.release();
    console.log('PASS migration up/down/up on disposable PostgreSQL');
    const [context] =
      await db.query(`SELECT s.student_uuid,s.person_uuid,s.school_term_id,s.classroom_id,s."SchoolID_Onec" AS school_id,
      s."GradeLevelID_Onec" AS grade_id,s."RoomID_Onec" AS room_id,g.label AS grade,
      t.academic_year,t.semester,t.starts_on::text,t.ends_on::text,t.status,
      sc.province,sc.district,sc.sub_district
      FROM student_term s JOIN school_terms t ON t.id=s.school_term_id
      JOIN schools sc ON sc.id=s."SchoolID_Onec" JOIN grade_levels g ON g.id=s."GradeLevelID_Onec"
      JOIN cases c ON c.student_uuid=s.student_uuid AND c.deleted_at IS NULL
      WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL
      ORDER BY (sc.id=10010004) DESC,t.academic_year DESC,t.semester DESC LIMIT 1`);
    assert(context, 'Need a real enrollment and case in the source smoke DB');
    const [role] = await db.query("SELECT default_permissions FROM roles WHERE name='ADMIN'");
    assert(role, 'Need admin permission catalog');
    const [actor] = await db.query(
      `INSERT INTO users(username,password,status,permissions,"FirstName","LastName",role,data_scope,must_change_password,data_origin_code)
      VALUES ($1,'NOT_A_LOGIN_CREDENTIAL','ACTIVE',$2::jsonb,'ทดสอบ','ภาคเรียน','ADMIN','{"global":true}'::jsonb,FALSE,'AUTOMATED_TEST') RETURNING id`,
      [`term_ui_${randomUUID()}`, JSON.stringify(role.default_permissions)],
    );
    const cookie = (() => {
      let result;
      app.get(SessionCookieService).setSession(
        {
          cookie: (name, value) => {
            result = { name, value };
          },
        },
        actor.id,
      );
      return result;
    })();
    await app.listen(0, '127.0.0.1');
    const backendUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const api = async (method, path, body) => {
      const res = await fetch(`${backendUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: `${cookie.name}=${cookie.value}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    };
    const original = {
      termId: Number(context.school_term_id),
      schoolId: context.school_id,
      academicYear: context.academic_year,
      semester: context.semester,
      startsOn: context.starts_on,
      endsOn: context.ends_on,
      status: context.status,
    };
    const [unused] = await db.query(
      'SELECT COALESCE(MAX(academic_year),$2)+1 AS year FROM school_terms WHERE school_id=$1',
      [context.school_id, context.academic_year],
    );
    const renamed = {
      ...original,
      academicYear: unused.year,
      semester: context.semester === 1 ? 2 : 1,
    };
    const beforeOther = await db.query(
      'SELECT student_uuid,"AcademicYear_Onec","Semester_Onec",school_term_id,classroom_id FROM student_term WHERE school_term_id<>$1 ORDER BY student_uuid',
      [original.termId],
    );
    const edited = await api('POST', '/attendance/terms', renamed);
    assert(
      edited.status === 201 && String(edited.body.data.id) === String(original.termId),
      'Edit did not preserve existing term ID',
    );
    const [linked] = await db.query(
      'SELECT "AcademicYear_Onec" AS year,"Semester_Onec" AS semester,school_term_id,classroom_id FROM student_term WHERE student_uuid=$1',
      [context.student_uuid],
    );
    assert(
      linked.year === renamed.academicYear &&
        linked.semester === renamed.semester &&
        linked.classroom_id === context.classroom_id,
      'Linked enrollment labels/classroom did not follow edit',
    );
    const [drift] = await db.query(
      `SELECT COUNT(*)::int AS n FROM student_risk_profiles p JOIN student_term s ON s.student_uuid=p.student_uuid
      WHERE s.school_term_id=$1 AND (p.academic_year<>s."AcademicYear_Onec" OR p.semester<>s."Semester_Onec")`,
      [original.termId],
    );
    assert(drift.n === 0, 'Risk-profile labels drifted after term edit');
    const afterOther = await db.query(
      'SELECT student_uuid,"AcademicYear_Onec","Semester_Onec",school_term_id,classroom_id FROM student_term WHERE school_term_id<>$1 ORDER BY student_uuid',
      [original.termId],
    );
    assert(
      JSON.stringify(beforeOther) === JSON.stringify(afterOther),
      'Edit changed a different term/school',
    );
    const auditService = app.get(AuditLogService);
    const originalAudit = auditService.recordAtomic.bind(auditService);
    auditService.recordAtomic = async () => {
      throw new Error('Synthetic audit rejection');
    };
    let rejectedEdit;
    try {
      rejectedEdit = await api('POST', '/attendance/terms', {
        ...renamed,
        academicYear: renamed.academicYear + 5,
      });
    } finally {
      auditService.recordAtomic = originalAudit;
    }
    assert(rejectedEdit.status === 500, 'Audit failure did not reject term edit');
    const [rolledBack] = await db.query(
      'SELECT t.academic_year,s."AcademicYear_Onec" AS enrollment_year FROM school_terms t JOIN student_term s ON s.school_term_id=t.id WHERE s.student_uuid=$1',
      [context.student_uuid],
    );
    assert(
      rolledBack.academic_year === renamed.academicYear &&
        rolledBack.enrollment_year === renamed.academicYear,
      'Audit failure left partially corrected labels',
    );
    const duplicate = await api('POST', '/attendance/terms', { ...renamed, termId: undefined });
    assert(duplicate.status === 409, 'Duplicate create overwrote existing term');
    const created = await api('POST', '/attendance/terms', {
      ...renamed,
      termId: undefined,
      academicYear: renamed.academicYear + 1,
      status: 'DRAFT',
    });
    assert(
      created.status === 201 && String(created.body.data.id) !== String(original.termId),
      'New term reused old ID',
    );
    const [newLinked] = await db.query(
      'SELECT COUNT(*)::int AS n FROM student_term WHERE school_term_id=$1',
      [created.body.data.id],
    );
    assert(newLinked.n === 0, 'New term moved old enrollments');
    const collision = await api('POST', '/attendance/terms', {
      ...renamed,
      academicYear: renamed.academicYear + 1,
      status: 'DRAFT',
    });
    assert(collision.status === 409, 'Term identity collision was not rejected');
    const [unchanged] = await db.query(
      'SELECT academic_year,semester,status FROM school_terms WHERE id=$1',
      [original.termId],
    );
    assert(
      unchanged.academic_year === renamed.academicYear &&
        unchanged.semester === renamed.semester &&
        unchanged.status === renamed.status,
      'Rejected edit partially changed the term',
    );
    const dates = await api('POST', '/attendance/terms', {
      ...renamed,
      startsOn: renamed.endsOn,
      endsOn: renamed.startsOn,
    });
    assert(dates.status === 400, 'Reversed dates accepted');
    // Retained classrooms remain legitimate existing FKs during correction.
    await db.query("UPDATE school_classrooms SET classroom_status='INACTIVE' WHERE id=$1", [
      context.classroom_id,
    ]);
    assert(
      (await api('POST', '/attendance/terms', original)).status === 201,
      'Historical inactive classroom blocked same-term correction',
    );
    await db.query("UPDATE school_classrooms SET classroom_status='ACTIVE' WHERE id=$1", [
      context.classroom_id,
    ]);
    const [audit] = await db.query(
      "SELECT COUNT(*)::int AS n FROM audit_log WHERE actor_user_id=$1 AND target_type='school_terms' AND metadata->>'op'='update'",
      [actor.id],
    );
    assert(audit.n >= 2, 'Term edits lack atomic audit provenance');
    console.log(
      'PASS edit/create separation, label propagation, old FKs, conflicts, dates, audit, other-term isolation',
    );
    for (const area of [
      {},
      { province: context.province },
      { province: context.province, district: context.district },
      { province: context.province, district: context.district, subDistrict: context.sub_district },
      { schoolId: String(context.school_id) },
    ]) {
      const query = new URLSearchParams(area).toString();
      const options = await api('GET', `/dashboard/risk-watchlist/filter-options?${query}`);
      assert(
        options.status === 200 &&
          options.body.data.terms.some(
            (t) => t.academicYear === original.academicYear && t.semester === original.semester,
          ),
        'Dynamic options lost real term at a geographic scope',
      );
      const period = `${query}&academicYear=${original.academicYear}&semester=${original.semester}&grade=${encodeURIComponent(context.grade)}&room=${context.room_id}`;
      for (const path of [
        '/dashboard/risk-watchlist',
        '/dashboard/referrals',
        '/dashboard/follow-up-summary',
      ])
        assert(
          (await api('GET', `${path}?${period}`)).status === 200,
          'Report tab rejected shared filters',
        );
    }
    const [newClassroom] = await db.query(
      `INSERT INTO school_classrooms(school_term_id,school_id,grade_level_id,legacy_room_number,room_code,classroom_status)
      SELECT $1,school_id,grade_level_id,legacy_room_number,room_code,'ACTIVE' FROM school_classrooms WHERE id=$2 RETURNING id`,
      [created.body.data.id, context.classroom_id],
    );
    const nextStudent = randomUUID();
    await db.query(
      `INSERT INTO student_term(student_uuid,person_uuid,"AcademicYear_Onec","Semester_Onec","SchoolID_Onec","PersonID_Onec",
      "GradeLevelID_Onec","RoomID_Onec","FirstName_Onec","LastName_Onec","StudentStatusID_Onec",student_status_code,school_term_id,classroom_id)
      SELECT $1,person_uuid,$2,$3,"SchoolID_Onec","PersonID_Onec","GradeLevelID_Onec","RoomID_Onec","FirstName_Onec","LastName_Onec","StudentStatusID_Onec",student_status_code,$4,$5
      FROM student_term WHERE student_uuid=$6`,
      [
        nextStudent,
        created.body.data.academicYear,
        created.body.data.semester,
        created.body.data.id,
        newClassroom.id,
        context.student_uuid,
      ],
    );
    const [resolution] = await db.query(
      'SELECT selected_student_uuid FROM student_current_enrollment_resolution WHERE person_uuid=$1',
      [context.person_uuid],
    );
    assert(
      resolution.selected_student_uuid === context.student_uuid,
      'Draft future enrollment replaced the current enrollment before opening',
    );
    assert(
      (await api('POST', '/attendance/terms', { ...original, status: 'CLOSED' })).status === 201,
      'Old term could not close without deleting history',
    );
    assert(
      (
        await api('POST', '/attendance/terms', {
          ...created.body.data,
          termId: Number(created.body.data.id),
          schoolId: context.school_id,
          status: 'ACTIVE',
        })
      ).status === 201,
      'Prepared next-year term could not open',
    );
    const [openedResolution] = await db.query(
      'SELECT selected_student_uuid FROM student_current_enrollment_resolution WHERE person_uuid=$1',
      [context.person_uuid],
    );
    assert(
      openedResolution.selected_student_uuid === nextStudent,
      'Opening the future term did not select its enrollment',
    );
    const history = await api(
      'GET',
      `/dashboard/risk-watchlist?studentGroup=RISK&schoolId=${context.school_id}&academicYear=${original.academicYear}&semester=${original.semester}&grade=${encodeURIComponent(context.grade)}&room=${context.room_id}&limit=${Math.max(...PAGE_SIZES)}`,
    );
    if (
      history.status !== 200 ||
      !history.body.data?.some((row) => row.studentId === context.student_uuid)
    ) {
      console.log(
        'Historical probe',
        JSON.stringify({
          status: history.status,
          total: history.body.meta?.totalCount,
          rows: history.body.data?.length,
          year: original.academicYear,
          semester: original.semester,
          error: history.body.message,
        }),
      );
    }
    assert(
      history.status === 200 &&
        history.body.data.some((row) => row.studentId === context.student_uuid),
      'Explicit old-term report lost enrollment after next-year enrollment',
    );
    const multipleTerms = await api(
      'GET',
      `/dashboard/risk-watchlist/filter-options?schoolId=${context.school_id}`,
    );
    assert(
      multipleTerms.body.data.terms.some(
        (t) => t.academicYear === created.body.data.academicYear,
      ) && multipleTerms.body.data.terms.some((t) => t.academicYear === original.academicYear),
      'Multi-year options omitted old or new enrollment',
    );
    const allPeriods = await api(
      'GET',
      `/dashboard/risk-watchlist?studentGroup=RISK&schoolId=${context.school_id}&grade=${encodeURIComponent(context.grade)}&room=${context.room_id}&limit=${Math.max(...PAGE_SIZES)}`,
    );
    assert(
      allPeriods.body.data.some(
        (row) =>
          row.studentId === context.student_uuid &&
          row.academicYear === original.academicYear &&
          row.semester === original.semester,
      ),
      'All-period report omitted retained history or period identity',
    );
    console.log(
      'PASS all geographic scopes, shared three-tab filters, retained history after next-year enrollment',
    );
    frontend = spawn(
      'pnpm',
      ['exec', 'vite', '--host', '127.0.0.1', '--port', '5178', '--strictPort'],
      {
        cwd: require('node:path').join(__dirname, '../../sts-frontend'),
        env: { ...process.env, VITE_API_BASE_URL: `${backendUrl}/api` },
        stdio: 'ignore',
      },
    );
    await waitFor(
      async () => (await fetch(frontendUrl).catch(() => null))?.ok,
      'Frontend did not start',
    );
    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Network.enable');
    const browserUser = {
      id: actor.id,
      username: 'term_ui_smoke',
      FirstName: 'ทดสอบ',
      LastName: 'ภาคเรียน',
      roles: ['ADMIN'],
      permissions: role.default_permissions,
      data_scope: { global: true },
      must_change_password: false,
    };
    await chrome.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('sts_user',${JSON.stringify(JSON.stringify(browserUser))});localStorage.setItem('admin_access','true');`,
    });
    await chrome.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: frontendUrl,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const navigate = async (path) => {
      await chrome.call('Page.navigate', { url: frontendUrl + path });
      await waitFor(
        () => chrome.evaluate('Boolean(document.querySelector("h1"))'),
        'Page title missing',
      );
    };
    const setSchool = async (value) =>
      chrome.evaluate(
        `import('/src/features/school-filter/store/school-filter.store.ts').then(m=>m.useSchoolFilterStore.getState().setFilter({schoolId:${JSON.stringify(value)},schoolName:'โรงเรียนทดสอบ',province:'',district:'',subDistrict:'',userId:${JSON.stringify(actor.id)}}))`,
      );
    await navigate('/student-risk-report');
    await waitFor(
      () => chrome.evaluate('Boolean(document.querySelector("[data-scope-filter-trigger]"))'),
      async () =>
        'Report filter probe ' +
        JSON.stringify(
          await chrome.evaluate(
            '({path:location.pathname,title:document.querySelector("h1")?.textContent,hasUser:!!localStorage.getItem("sts_user")})',
          ),
        ),
    );
    await chrome.clickText('ชั้น/ห้อง');
    await waitFor(
      () =>
        chrome.evaluate(
          'Boolean(document.querySelector("button[aria-label=ภาคเรียน]:not(:disabled)"))',
        ),
      'Term picker unavailable',
    );
    await chrome.evaluate('document.querySelector("button[aria-label=ภาคเรียน]").click()');
    assert(
      await chrome.evaluate(
        `!![...document.querySelectorAll('[role=option]')].find(o=>o.innerText.includes(${JSON.stringify('ภาคเรียนที่ ' + original.semester)}))`,
      ),
      'Actual term option missing',
    );
    await chrome.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await navigate('/manage-users');
    const hidden = await chrome.evaluate(
      `(()=>{const input=document.querySelector('input[placeholder*="ค้นหาชื่อผู้ใช้งาน"]');const parent=input?.closest('[inert]');return {hidden:!!parent&&getComputedStyle(parent).visibility==='hidden',height:parent?.getBoundingClientRect().height||0}})()`,
    );
    assert(
      hidden.hidden && hidden.height > 0,
      'Prerequisite filters did not hide while reserving space',
    );
    await setSchool(String(context.school_id));
    await waitFor(
      () =>
        chrome.evaluate(
          '!document.querySelector("input[placeholder*=ค้นหาชื่อผู้ใช้งาน]")?.closest("[inert]")',
        ),
      'Filters did not return after school selection',
    );
    await navigate('/school-structure');
    await chrome.clickText('เพิ่มภาคเรียน');
    await chrome.evaluate('document.querySelector("button[aria-label=วันเริ่ม]").click()');
    await waitFor(
      () =>
        chrome.evaluate('Boolean(document.querySelector("[role=dialog][aria-label=เลือกวันที่]"))'),
      'Calendar did not open',
    );
    const calendar = await chrome.evaluate(
      `(()=>{const panel=document.querySelector('[role=dialog][aria-label=เลือกวันที่]');const r=panel.getBoundingClientRect();const button=panel.querySelector('button');const b=button.getBoundingClientRect();return {portaled:!panel.closest('[aria-modal="true"]'),hit:panel.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),width:r.width,left:r.left,right:r.right,bottom:r.bottom,viewport:innerWidth,height:innerHeight}})()`,
    );
    assert(
      calendar.portaled &&
        calendar.hit &&
        calendar.left >= 0 &&
        calendar.right <= calendar.viewport &&
        calendar.bottom <= calendar.height,
      'Desktop calendar clipped or sunk',
    );
    await chrome.evaluate(
      `document.querySelector('[role=dialog][aria-label=เลือกวันที่] button[aria-label]').click()`,
    );
    assert(
      await chrome.evaluate(
        'Boolean(document.querySelector("[role=dialog][aria-label=เลือกวันที่]"))',
      ),
      'Calendar navigation dismissed panel',
    );
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await chrome.evaluate('document.querySelector("button[aria-label=วันเริ่ม]").click()');
    await waitFor(
      () =>
        chrome.evaluate('Boolean(document.querySelector("[role=dialog][aria-label=เลือกวันที่]"))'),
      'Mobile calendar missing',
    );
    assert(
      await chrome.evaluate(
        `(()=>{const p=document.querySelector('[role=dialog][aria-label=เลือกวันที่]');const r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth+1})()`,
      ),
      'Mobile calendar overflows viewport',
    );
    await chrome.evaluate(
      "import('/scripts/smoke-overlay-harness.ts').then(m=>m.mountOverlayProbe())",
    );
    await waitFor(
      () => chrome.evaluate('Boolean(document.querySelector("button[aria-label=เวลาทดสอบ]"))'),
      'Overlay harness did not mount',
    );
    const inViewport = async (selector) =>
      chrome.evaluate(
        `(()=>{const p=document.querySelector(${JSON.stringify(selector)});if(!p)return false;const r=p.getBoundingClientRect();const b=p.querySelector('button')?.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&(!b||p.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)))})()`,
      );
    await chrome.evaluate('document.querySelector("button[aria-label=เวลาทดสอบ]").click()');
    await waitFor(
      () => inViewport('[role=dialog][aria-label=เลือกเวลา]'),
      'Narrow right-side time panel overflowed or sank',
    );
    await chrome.evaluate('document.querySelector("button[aria-label=ชั่วโมง]").click()');
    await chrome.clickText('09', `document.querySelector('[role=listbox]')`);
    assert(
      await chrome.evaluate(
        'window.__timeChoice==="09:30" && !!document.querySelector("[role=dialog][aria-label=เลือกเวลา]")',
      ),
      'Nested time choice closed its parent',
    );
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 360,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await chrome.evaluate('document.querySelector("button[aria-label=ชั่วโมง]").click()');
    await waitFor(
      () => inViewport('[role=listbox]'),
      'Nested Select overflowed the short 640x360 viewport',
    );
    const shortSelect = await chrome.evaluate(
      `(()=>{const p=document.querySelector('[role=listbox]');const r=p.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,maxHeight:parseFloat(p.style.maxHeight),scrollable:p.scrollHeight>p.clientHeight}})()`,
    );
    assert(
      shortSelect.maxHeight > 0 && shortSelect.maxHeight < 224 && shortSelect.scrollable,
      'Short Select did not clamp its height with scrollable options',
    );
    const shortScreenshot = await chrome.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/sts-select-short-viewport.png', Buffer.from(shortScreenshot.result.data, 'base64'));
    await chrome.clickText('23', `document.querySelector('[role=listbox]')`);
    assert(
      await chrome.evaluate(
        'window.__timeChoice==="23:30" && !!document.querySelector("[role=dialog][aria-label=เลือกเวลา]") && !document.querySelector("[role=listbox]")',
      ),
      'Last hour was not selectable or nested Select dismissed its parent',
    );
    console.log('PASS Chrome nested Select 640x360 clamp/scroll/last-option pointer choice', shortSelect);
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await chrome.evaluate(
      'document.querySelector("button[aria-label=เวลาทดสอบ]").click();document.querySelector("input[aria-label=เลือกหลายค่าทดสอบ]").click()',
    );
    await waitFor(
      () => inViewport('[role=listbox][aria-multiselectable=true]'),
      'Multi-select overflowed or sank',
    );
    await chrome.clickText('ค่าทดสอบ', `document.querySelector('[aria-multiselectable=true]')`);
    assert(
      await chrome.evaluate('window.__multiChoice?.[0]==="fixture"'),
      'Multi-select choice was dismissed',
    );
    await chrome.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    const comboBox = await chrome.evaluate(
      `(()=>{const i=document.querySelector('input[aria-label=ค้นหาทดสอบ]');const r=i.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await chrome.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...comboBox,
      button: 'left',
      clickCount: 1,
    });
    await chrome.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...comboBox,
      button: 'left',
      clickCount: 1,
    });
    await waitFor(
      () =>
        chrome.evaluate(
          `(()=>{const input=document.querySelector('input[aria-label=ค้นหาทดสอบ]');const panel=[...document.querySelectorAll('ul')].find(p=>p.textContent.includes('ค่าค้นหาทดสอบ'));if(!panel)return false;const r=panel.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&!!input})()`,
        ),
      'Combobox overflowed or sank',
    );
    await chrome.clickText(
      'ค่าค้นหาทดสอบ',
      `[...document.querySelectorAll('ul')].find(p=>p.textContent.includes('ค่าค้นหาทดสอบ'))`,
    );
    assert(
      await chrome.evaluate('window.__comboChoice==="fixture"'),
      'Combobox choice was dismissed',
    );
    await chrome.clickText('เปิดเมนูทดสอบ');
    await waitFor(
      () => inViewport('[role=menu][aria-label=เมนูทดสอบ]'),
      'Long row menu overflowed or sank',
    );
    const screenshot = await chrome.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/sts-overlay-mobile.png', Buffer.from(screenshot.result.data, 'base64'));
    await chrome.clickText(
      'คำสั่งทดสอบ 0',
      `document.querySelector('[role=menu][aria-label=เมนูทดสอบ]')`,
    );
    assert(await chrome.evaluate('window.__menuChoice===0'), 'Menu item was not clickable');
    await chrome.evaluate('window.__overlayRoot.unmount()');
    console.log(
      'PASS Chrome Date/Time/MultiSelect/Combobox/DropdownMenu geometry and real pointer choices',
    );
    console.log(
      'PASS Chrome report filter, school-prerequisite space, desktop/mobile calendar hit-testing',
    );
  } finally {
    chrome?.close();
    frontend?.kill('SIGTERM');
    await app?.close();
    if (cloned) psql(`DROP DATABASE ${verifyDbName} WITH (FORCE)`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

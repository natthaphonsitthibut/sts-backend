// Runs real check-in requests in Chrome against an isolated smoke classroom.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const { SchedulerRegistry } = require('@nestjs/schedule');
const buildRoot = process.env.SMOKE_BUILD_ROOT || '../dist';
const { AppModule } = require(`${buildRoot}/app.module`);
const { SessionCookieService } = require(`${buildRoot}/auth/session-cookie.service`);
const { AppExceptionFilter } = require(`${buildRoot}/common/filters/app-exception.filter`);
const { RiskProfileService } = require(`${buildRoot}/risk-profile/risk-profile.service`);
const { RiskProfileRepository } = require(`${buildRoot}/risk-profile/risk-profile.repository`);
const { AbsenceMonitorService } = require(`${buildRoot}/automation/absence-monitor.service`);
const { createValidationException } = require(`${buildRoot}/common/validation/validation-exception.factory`);
if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Requires a non-production *_smoke database');
}
function assert(value, message) { if (!value) throw new Error(message); }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function cleanupFixture(db, { classroom, person, student, user, foreignCase }) {
  if (classroom) {
      const runner=db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
      try {
        if(foreignCase)await runner.query('DELETE FROM cases WHERE id=$1 AND student_uuid IS NULL AND created_by=$2',[foreignCase,user]);
        await runner.query('DELETE FROM notifications WHERE case_id IN (SELECT id FROM cases WHERE student_uuid=$1)',[student]);
        await runner.query('DELETE FROM student_risk_profiles WHERE student_uuid=$1',[student]);
        await runner.query('DELETE FROM cases WHERE student_uuid=$1',[student]);
        // Audit is append-only: disable its guard only inside fixture cleanup, like existing browser smokes.
        await runner.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
        await runner.query("DELETE FROM audit_log WHERE actor_user_id=$1 OR (actor_label='system:absence-monitor' AND metadata->>'studentUuid'=$2)",[user,student]);
        await runner.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
        await runner.query('ALTER TABLE attendance_submission_changes DISABLE TRIGGER USER');
        await runner.query('ALTER TABLE attendance_submission_history DISABLE TRIGGER USER');
        await runner.query('DELETE FROM attendance_submission_changes WHERE session_id IN (SELECT id FROM attendance_sessions WHERE classroom_id=$1)',[classroom]);
        await runner.query('DELETE FROM attendance_submission_history WHERE session_id IN (SELECT id FROM attendance_sessions WHERE classroom_id=$1)',[classroom]);
        await runner.query('ALTER TABLE attendance_submission_changes ENABLE TRIGGER USER');
        await runner.query('ALTER TABLE attendance_submission_history ENABLE TRIGGER USER');
        await runner.query('DELETE FROM attendance_exceptions WHERE session_id IN (SELECT id FROM attendance_sessions WHERE classroom_id=$1)',[classroom]);
        await runner.query('DELETE FROM attendance_session_roster WHERE session_id IN (SELECT id FROM attendance_sessions WHERE classroom_id=$1)',[classroom]);
        await runner.query('DELETE FROM attendance_sessions WHERE classroom_id=$1',[classroom]);
        await runner.query('DELETE FROM classroom_subjects WHERE classroom_id=$1',[classroom]);
        await runner.query('DELETE FROM student_term WHERE student_uuid=$1',[student]);
        await runner.query('DELETE FROM school_classrooms WHERE id=$1',[classroom]);
        await runner.query('DELETE FROM student_person WHERE person_uuid=$1',[person]);
        if(user)await runner.query('DELETE FROM users WHERE id=$1 AND data_origin_code=\'AUTOMATED_TEST\'',[user]);
        await runner.commitTransaction();
      } catch(error) {await runner.rollbackTransaction();throw error;} finally {await runner.release();}
    }
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RiskProfileService).useValue({
      requestStudentRecalculation: async (students) => {
        const repository = moduleRef.get(RiskProfileRepository);
        await repository.recalculateStudents(students, await repository.getRiskThresholds());
      }, enqueueFull: async () => {},
      refreshDailyRecalcCron: async () => {},
    }).compile();
  const app = moduleRef.createNestApplication({logger: ['error']});
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true,
    forbidNonWhitelisted: true, forbidUnknownValues: false,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: createValidationException }));
  app.useGlobalFilters(new AppExceptionFilter());
  const db = app.get(DataSource);
  const person = randomUUID();
  const student = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  let classroom, offering, user, foreignCase, chrome, socket, profile;
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    await app.init();
    assert(!app.get(SchedulerRegistry).doesExist('cron', 'check_consecutive_absences_job'),
      'Legacy daily absence cron still registered');
    // Recover only this script's previous fixtures after an interrupted run.
    const leftovers = await db.query(`SELECT c.id::int AS classroom,
      e.person_uuid AS person,e.student_uuid AS student,u.id::int AS "user"
      FROM school_classrooms c JOIN student_term e ON e.classroom_id=c.id
      JOIN users u ON u.username='immediate_alert_' || substring(e."PersonID_Onec" from 7)
        AND u.data_origin_code='AUTOMATED_TEST'
      WHERE c.room_name='ทดสอบแจ้งเตือนทันที' AND e."PersonID_Onec" LIKE 'SMOKE_%'
        AND e."FirstName_Onec"='ทดสอบ' AND e."LastName_Onec"='แจ้งเตือนทันที'`);
    for (const fixture of leftovers) await cleanupFixture(db, fixture);
    if (process.env.SMOKE_RECOVER_ONLY === '1') {
      console.log(`Recovered ${leftovers.length} interrupted immediate-alert fixture(s)`);
      return;
    }
    const [context] = await db.query(`SELECT t.id AS term_id, t.school_id, t.academic_year, t.semester,
      c.grade_level_id, c.legacy_room_number, ss.id AS school_subject_id,
      t.starts_on::text AS first_date,
      (t.starts_on + 1)::text AS second_date, (t.starts_on + 2)::text AS third_date
      FROM school_terms t JOIN schools s ON s.id=t.school_id AND s.school_status='ACTIVE'
      JOIN school_classrooms c ON c.school_term_id=t.id AND c.deleted_at IS NULL
      JOIN school_subjects ss ON ss.school_id=t.school_id AND ss.deleted_at IS NULL
        AND ss.subject_status='ACTIVE'
      WHERE t.status='ACTIVE' AND t.deleted_at IS NULL AND c.legacy_room_number IS NOT NULL
        AND t.starts_on + 2 <= LEAST(t.ends_on, (now() AT TIME ZONE 'Asia/Bangkok')::date)
      ORDER BY t.academic_year DESC, t.semester DESC, t.id LIMIT 1`);
    assert(context, 'Need an active term with at least three past dates');
    const [nextRoom] = await db.query('SELECT COALESCE(MAX(legacy_room_number),0)+1 AS room FROM school_classrooms WHERE school_term_id=$1 AND grade_level_id=$2', [context.term_id,context.grade_level_id]);
    const [room] = await db.query(`INSERT INTO school_classrooms
      (school_term_id,school_id,grade_level_id,room_code,room_name,classroom_status,legacy_room_number)
      VALUES ($1,$2,$3,$4,'ทดสอบแจ้งเตือนทันที','ACTIVE',
        (SELECT COALESCE(MAX(legacy_room_number),0)+1 FROM school_classrooms WHERE school_term_id=$1 AND grade_level_id=$3))
      RETURNING id,legacy_room_number`,
      [context.term_id,context.school_id,context.grade_level_id,String(nextRoom.room)]);
    classroom = Number(room.id);
    context.legacy_room_number = Number(room.legacy_room_number);
    const [subject] = await db.query(`INSERT INTO classroom_subjects
      (school_id,classroom_id,school_subject_id) VALUES ($1,$2,$3) RETURNING id`,
      [context.school_id,classroom,context.school_subject_id]);
    offering = Number(subject.id);
    await db.query(`INSERT INTO student_person(person_uuid,identity_status) VALUES ($1,'ACTIVE')`,[person]);
    await db.query(`INSERT INTO student_term(student_uuid,person_uuid,"PersonID_Onec",
      "FirstName_Onec","LastName_Onec","SchoolID_Onec","GradeLevelID_Onec","RoomID_Onec",
      "AcademicYear_Onec","Semester_Onec","StudentStatusID_Onec",student_status_code)
      VALUES ($1,$2,$3,'ทดสอบ','แจ้งเตือนทันที',$4,$5,$6,$7,$8,10,10)`,
      [student,person,`SMOKE_${suffix}`,context.school_id,context.grade_level_id,
        context.legacy_room_number,context.academic_year,context.semester]);
    const [actor] = await db.query(`INSERT INTO users(username,password,status,permissions,
      "FirstName","LastName",role,data_scope,must_change_password,data_origin_code)
      VALUES ($1,'NOT_A_LOGIN_CREDENTIAL','ACTIVE',$2::jsonb,'ทดสอบ','แจ้งเตือน',
        'ADMIN',$3::jsonb,FALSE,'AUTOMATED_TEST') RETURNING id`,
      [`immediate_alert_${suffix}`,JSON.stringify(['attendance','settings','review-cases','case:assign','dashboard']),
        JSON.stringify({global:true})]);
    user = Number(actor.id);
    const [otherSchool] = await db.query('SELECT id FROM schools WHERE id<>$1 ORDER BY id LIMIT 1',[context.school_id]);
    assert(otherSchool,'Need a second school to test legacy name scope');
    const [foreign] = await db.query(`INSERT INTO cases(student_name,school_id,reason_flagged,status,created_by)
      VALUES ('ทดสอบ แจ้งเตือนทันที',$1,'ผู้ปกครองขอติดตามเรื่องการเดินทาง','OPEN',$2) RETURNING id`,[otherSchool.id,user]);
    foreignCase=Number(foreign.id);
    // Frozen fixture roster isolates this test from existing classroom students.
    const sessions = [];
    for (const date of [context.first_date,context.second_date,context.third_date]) {
      const [session] = await db.query(`INSERT INTO attendance_sessions
        (school_term_id,school_id,grade_level_id,room_id,classroom_id,attendance_date,
        session_kind,classroom_subject_id,status,expected_roster_count,recorded_count,period,
        exception_count,record_storage_mode,checking_started_at,created_by,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,'SUBJECT',$7,'OPEN',1,0,NULL,0,'EXCEPTIONS',now(),$8,$8) RETURNING id`,
        [context.term_id,context.school_id,context.grade_level_id,context.legacy_room_number,
          classroom,date,offering,user]);
      await db.query(`INSERT INTO attendance_session_roster(session_id,student_uuid,school_id)
        VALUES ($1,$2,$3)`,[session.id,student,context.school_id]);
      sessions.push(session.id);
    }
    await app.listen(0,'127.0.0.1');
    const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    profile = fs.mkdtempSync(path.join(os.tmpdir(),'sts-immediate-alert-'));
    const port = 9377;
    chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,
        '--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
    let tabs;
    for (let attempt=0;attempt<100;attempt++) {
      try { tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if(tabs.length)break; } catch {}
      await pause(100);
    }
    assert(tabs?.length,'Chrome failed to start');
    socket = new WebSocket(tabs.find((tab)=>tab.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message', (event)=>{
      const result=JSON.parse(event.data); const task=pending.get(result.id); if(!task)return;
      pending.delete(result.id); result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result);
    });
    let cookie;
    app.get(SessionCookieService).setSession({cookie:(name,value)=>{cookie={name,value};}},user);
    await send('Network.setCookie',{...cookie,url:origin});
    await send('Page.navigate',{url:`${origin}/api/health/live`});
    for(let attempt=0;attempt<100;attempt++){
      if(await evaluate(`location.origin === ${JSON.stringify(origin)}`))break;
      await pause(50);
    }
    const request = (route,body) => evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)},
      {method:${JSON.stringify(body?'POST':'GET')},credentials:'include',
        headers:{'Content-Type':'application/json'},${body?`body:${JSON.stringify(JSON.stringify(body))},`:''}});
      return {status:r.status,body:await r.json()};})()`);
    const marks={exceptions:[{studentId:student,status:'P_ABSENT'}]};
    for(const session of sessions.slice(0,2)) {
      const result=await request(`/api/attendance/check-in/sessions/${session}/submit`,marks);
      assert(result.status===201,`Submit failed: HTTP ${result.status}`);
    }
    const counts=async()=>{
      const [row]=await db.query(`SELECT
        (SELECT count(*)::int FROM cases WHERE student_uuid=$1 AND deleted_at IS NULL) AS cases,
        (SELECT count(*)::int FROM notifications n JOIN cases c ON c.id=n.case_id
          WHERE c.student_uuid=$1 AND n.case_status_code='OPEN') AS alerts`,[student]);
      return row;
    };
    assert((await counts()).cases===0,'Case opened before threshold');
    const monitor=app.get(AbsenceMonitorService);
    const [third, duplicate] = await Promise.all([
      request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,marks),
      request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,marks),
      monitor.checkConsecutiveAbsences([student]),
      monitor.checkConsecutiveAbsences([student]),
    ]);
    assert(duplicate.status===201,'Concurrent duplicate submit failed');
    assert(third.status===201,'Threshold submit failed');
    const baseline=await counts();
    assert(baseline.cases===1,'Case was not opened immediately');
    const [risky] = await db.query('SELECT risk_tier,open_case_count FROM student_risk_profiles WHERE student_uuid=$1',[student]);
    assert(risky?.risk_tier==='HIGH' && risky.open_case_count===1,'Risk status not updated immediately');
    assert(baseline.alerts>0,'No scoped recipient received an immediate notification');
    // Multiple app requests and explicit monitors race on the same student.
    await Promise.all([request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,marks),
      request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,marks),
      monitor.checkConsecutiveAbsences([student]),monitor.checkConsecutiveAbsences([student])]);
    assert(JSON.stringify(await counts())===JSON.stringify(baseline),'Duplicate case or notification');
    const corrected=await request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,{
      exceptions:[],correctionReason:'ตรวจสอบว่ามาเรียนแล้ว',expectedLockVersion:third.body.data.lockVersion});
    assert(corrected.status===201,'Correction failed');
    const reverted = await counts();
    assert(reverted.cases===0,'Corrected attendance did not cancel the open absence case');
    assert(reverted.alerts===0,'Obsolete notifications remained after correction');
    const [normal] = await db.query('SELECT risk_tier,open_case_count FROM student_risk_profiles WHERE student_uuid=$1',[student]);
    assert(normal?.risk_tier==='NORMAL' && normal.open_case_count===0,'Risk status did not revert immediately');
    // A manual reason may also begin with ขาดเรียน; its opener determines
    // whether attendance correction is allowed to remove the case.
    const manualReason='ขาดเรียนสะสมและผู้ปกครองขอให้ติดตามเรื่องการเดินทาง';
    const manual=await request('/api/cases',{student_id:student,reason:manualReason});
    assert(manual.status===200 && manual.body.created===true,'Manual case creation failed');
    const manualId=Number(manual.body.data.id);
    let latestVersion=corrected.body.data.lockVersion;
    for(const status of ['OPEN','IN_PROGRESS','PENDING_REVIEW','STUDENT_NOT_FOUND','AWAITING_REFERRAL','AWAITING_REFERRAL_OUTCOME']){
      await db.query('UPDATE cases SET status=$1 WHERE id=$2',[status,manualId]);
      const submitted=await request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,{
        ...marks,correctionReason:'ทดสอบเกณฑ์ขาดร่วมกับเคสที่เปิดเอง',expectedLockVersion:latestVersion});
      assert(submitted.status===201,`Manual ${status} attendance submit failed`);
      latestVersion=submitted.body.data.lockVersion;
      const liveCases=await db.query('SELECT id,status,reason_flagged FROM cases WHERE student_uuid=$1 AND deleted_at IS NULL',[student]);
      assert(liveCases.length===1 && Number(liveCases[0].id)===manualId && liveCases[0].status===status && liveCases[0].reason_flagged===manualReason,
        `Manual ${status} case was duplicated or changed`);
    }
    await db.query("UPDATE cases SET status='OPEN' WHERE id=$1",[manualId]);
    const manualBaseline=await counts();
    const manualCorrection=await request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,{
      exceptions:[],correctionReason:'แก้เช็กชื่อโดยคงงานติดตามของครู',expectedLockVersion:latestVersion});
    assert(manualCorrection.status===201,'Manual-case attendance correction failed');
    assert(JSON.stringify(await counts())===JSON.stringify(manualBaseline),'Manual case or its notification was removed after correction');
    const [kept]=await db.query('SELECT reason_flagged,deleted_at FROM cases WHERE id=$1',[manualId]);
    assert(!kept.deleted_at && kept.reason_flagged===manualReason,'Manual opening reason was lost');
    await db.query('UPDATE cases SET deleted_at=now() WHERE id=$1',[manualId]);
    latestVersion=manualCorrection.body.data.lockVersion;
    // Exercise creation in both routes concurrently and retry it several times.
    for(let round=0;round<3;round++){
      const raceReason='ครูขอให้ติดตามการเดินทางและประสานครอบครัว';
      const [opened,submitted]=await Promise.all([
        request('/api/cases',{student_id:student,reason:raceReason}),
        request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,{
          ...marks,correctionReason:'ตรวจการแข่งขันเปิดเคสกับบันทึกขาด',expectedLockVersion:latestVersion}),
      ]);
      assert(opened.status===200 && submitted.status===201,'Manual/automatic creation race returned an error');
      const active=await db.query('SELECT id,reason_flagged FROM cases WHERE student_uuid=$1 AND deleted_at IS NULL',[student]);
      assert(active.length===1 && Number(active[0].id)===Number(opened.body.data.id),'Manual/automatic creation race made duplicate cases');
      if(opened.body.created)assert(active[0].reason_flagged===raceReason,'Automatic monitor replaced the manual reason');
      await db.query('UPDATE cases SET deleted_at=now() WHERE id=$1',[active[0].id]);
      const reset=await request(`/api/attendance/check-in/sessions/${sessions[2]}/submit`,{
        exceptions:[],correctionReason:'คืนข้อมูลก่อนทดสอบการแข่งขันรอบถัดไป',expectedLockVersion:submitted.body.data.lockVersion});
      assert(reset.status===201,'Race fixture attendance reset failed');
      latestVersion=reset.body.data.lockVersion;
    }
    const [foreignKept]=await db.query('SELECT deleted_at FROM cases WHERE id=$1',[foreignCase]);
    assert(foreignKept && !foreignKept.deleted_at,'Case in another school was affected');
    const settings=await request('/api/settings');
    assert(settings.status===200,'Settings request failed');
    assert(!JSON.stringify(settings.body).includes('ALERT_TRIGGER_TYPE') &&
      !JSON.stringify(settings.body).includes('ALERT_SCHEDULE_TIME'),'Legacy cadence settings still exposed');
    console.log('PASS Chrome check-in: immediate/correction, manual six states, preserved manual reason/notification, three manual-auto races, school scope, no cron/settings');
  } finally {
    socket?.close(); chrome?.kill('SIGTERM');
    await cleanupFixture(db, {classroom, person, student, user, foreignCase});
    await app.close();
    if(profile){await pause(300);fs.rmSync(profile,{recursive:true,force:true});}
  }
}
main().catch((error)=>{console.error('FAIL immediate absence browser smoke:', error.code || error.name, String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/g, '[REDACTED_URL]'));process.exitCode=1;});

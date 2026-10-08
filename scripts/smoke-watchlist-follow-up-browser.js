const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
const { RiskProfileRepository } = require('../dist/risk-profile/risk-profile.repository');
const { createValidationException } = require('../dist/common/validation/validation-exception.factory');
if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Requires non-production *_smoke database');
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) { if (!value) throw new Error(message); }
async function waitFor(check, message, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw new Error(typeof message === 'function' ? await message() : message);
}
async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RiskProfileService).useValue({
      requestStudentRecalculation: async (students) => {
        const repo = moduleRef.get(RiskProfileRepository);
        await repo.recalculateStudents(students, await repo.getRiskThresholds());
      }, enqueueFull: async () => {}, refreshDailyRecalcCron: async () => {},
    }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true,
    forbidNonWhitelisted: true, forbidUnknownValues: false,
    transformOptions: { enableImplicitConversion: true }, exceptionFactory: createValidationException }));
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableCors({ origin: 'http://127.0.0.1:5174', credentials: true });
  const db = app.get(DataSource);
  const person = randomUUID(); const student = randomUUID(); const suffix = randomUUID().slice(0,8);
  let actorId, deniedId, chrome, frontend, socket, profile, caseId, commentIds = [];
  const pending = new Map(); let nextId = 0;
  const send = (method,params={}) => new Promise((resolve,reject)=>{
    const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async (expression) => {
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const clickText = async (text) => {
    await waitFor(()=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length>0 && b.innerText.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true;})()`),`Missing button: ${text}`);
  };
  try {
    await app.init();
    const [context]=await db.query(`SELECT c.id::int AS classroom_id,c.school_id,c.grade_level_id,
      c.legacy_room_number,t.academic_year,t.semester,h.teacher_membership_id
      FROM school_classrooms c JOIN school_terms t ON t.id=c.school_term_id
      JOIN schools s ON s.id=c.school_id AND s.school_status='ACTIVE'
      JOIN classroom_homeroom_teacher_assignments h ON h.classroom_id=c.id AND h.is_primary
      JOIN school_teacher_memberships m ON m.id=h.teacher_membership_id AND m.membership_status='ACTIVE' AND m.deleted_at IS NULL
      WHERE c.classroom_status='ACTIVE' AND c.deleted_at IS NULL AND t.status='ACTIVE' AND t.deleted_at IS NULL
        AND c.legacy_room_number IS NOT NULL
      ORDER BY t.academic_year DESC,t.semester DESC,c.id LIMIT 1`);
    assert(context,'Need an active classroom with primary homeroom teacher');
    await db.query(`INSERT INTO student_person(person_uuid,identity_status) VALUES ($1,'ACTIVE')`,[person]);
    await db.query(`INSERT INTO student_term(student_uuid,person_uuid,"PersonID_Onec","FirstName_Onec","LastName_Onec",
      "SchoolID_Onec","GradeLevelID_Onec","RoomID_Onec","AcademicYear_Onec","Semester_Onec","StudentStatusID_Onec",student_status_code)
      VALUES ($1,$2,$3,'ทดสอบ',$4,$5,$6,$7,$8,$9,10,10)`,[student,person,`SMOKE_WATCHLIST_${suffix}`,`เฝ้าระวัง${suffix}`,
      context.school_id,context.grade_level_id,context.legacy_room_number,context.academic_year,context.semester]);
    const permissions=['dashboard','case:assign','case:review','students','attendance'];
    const [actor]=await db.query(`INSERT INTO users(username,password,status,permissions,"FirstName","LastName",
      role,data_scope,must_change_password,data_origin_code)
      VALUES ($1,'NOT_A_LOGIN_CREDENTIAL','ACTIVE',$2::jsonb,'ผู้อำนวยการ','ทดสอบ','ADMIN',$3::jsonb,FALSE,'AUTOMATED_TEST') RETURNING id`,
      [`watchlist_followup_${suffix}`,JSON.stringify(permissions),JSON.stringify({school_ids:[context.school_id]})]);
    actorId=actor.id;
    const [denied]=await db.query(`INSERT INTO users(username,password,status,permissions,"FirstName","LastName",
      role,data_scope,must_change_password,data_origin_code)
      VALUES ($1,'NOT_A_LOGIN_CREDENTIAL','ACTIVE',$2::jsonb,'ผู้ใช้งาน','นอกขอบเขต','ADMIN',$3::jsonb,FALSE,'AUTOMATED_TEST') RETURNING id`,
      [`watchlist_denied_${suffix}`,JSON.stringify(permissions),JSON.stringify({school_ids:[2147483647]})]);
    deniedId=denied.id;
    const makeCookie=(userId)=>{let cookie;app.get(SessionCookieService).setSession({cookie:(name,value)=>{cookie={name,value};}},userId);return cookie;};
    const actorCookie=makeCookie(actorId); const deniedCookie=makeCookie(deniedId);
    await app.listen(0,'127.0.0.1');const origin=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    const api=async(method,route,body,cookie=actorCookie)=>{
      const response=await fetch(`${origin}/api${route}`,{method,headers:{'Content-Type':'application/json',Cookie:`${cookie.name}=${cookie.value}`},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json()};
    };
    const categories=await api('GET','/school-structure/student-problem-categories');
    const category=categories.body.data?.[0]?.code;assert(category,'Missing problem categories');
    // Every existing level remains a comment; none may auto-open a case.
    for(const level of ['NOTE','WATCH','CONCERN']){
      const response=await api('POST',`/school-structure/classrooms/${context.classroom_id}/students/${student}/comments`,
        {problemCategory:category,concernLevelCode:level,problemDescription:`ทดสอบติดตามเฝ้าระวัง ${level}`});
      assert(response.status===201,`Comment failed for ${level}: HTTP ${response.status}`);
      commentIds.push(response.body.data.id);
      const [count]=await db.query('SELECT count(*)::int AS total FROM cases WHERE student_uuid=$1 AND deleted_at IS NULL',[student]);
      assert(count.total===0,`${level} unexpectedly auto-opened a case`);
    }
    frontend=spawn('pnpm',['dev','--host','127.0.0.1','--port','5174','--strictPort'],{
      cwd:path.resolve(__dirname,'../../sts-frontend'),stdio:'ignore'});
    await waitFor(async()=>{try{return (await fetch('http://127.0.0.1:5174')).ok;}catch{return false;}},'Frontend failed to start');
    profile=fs.mkdtempSync(path.join(os.tmpdir(),'sts-watchlist-browser-'));
    chrome=spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ['--headless=new','--remote-debugging-port=9378',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
    let tabs;
    await waitFor(async()=>{try{tabs=await (await fetch('http://127.0.0.1:9378/json/list')).json();return tabs.some(t=>t.type==='page');}catch{return false;}},'Chrome failed to start');
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{const r=JSON.parse(event.data),t=pending.get(r.id);if(!t)return;pending.delete(r.id);r.error?t.reject(new Error(r.error.message)):t.resolve(r.result);});
    await send('Page.enable');await send('Network.enable');
    const browserUser = { id: actorId, username: `watchlist_followup_${suffix}`, FirstName: 'ผู้อำนวยการ',
      LastName: 'ทดสอบ', roles: ['ADMIN'], permissions, data_scope: {school_ids:[context.school_id]}, must_change_password:false };
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
      localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(browserUser))});
      localStorage.setItem('admin_access','true');
      const scrollOriginal=Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView=function(options){if(this.hasAttribute('data-flow-step'))window.__stsLatestScroll=this;return scrollOriginal.call(this,options);};
      const origin=${JSON.stringify(origin)};
      const rewrite=url=>{if(typeof url!=='string')return url;const p=new URL(url,location.origin);return p.pathname.startsWith('/api/')?origin+p.pathname+p.search:url;};
      const fetchOriginal=window.fetch;window.fetch=(input,init)=>fetchOriginal(typeof input==='string'?rewrite(input):input,init);
      const openOriginal=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){return openOriginal.call(this,method,rewrite(url),...rest);};})()`});
    await send('Network.setCookie',{...actorCookie,url:'http://127.0.0.1:5174'});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const url='http://127.0.0.1:5174/student-risk-report/watchlist';
    const fixtureRow=`[...document.querySelectorAll('[data-student-navigation]')].find(r=>r.offsetParent!==null && r.getAttribute('data-student-navigation')===${JSON.stringify(student)})`;
    const waitRow=async()=>{await waitFor(()=>evaluate(`Boolean(${fixtureRow})`),'Watchlist fixture row did not render');};
    await send('Page.navigate',{url});
    await waitFor(()=>evaluate(`Boolean(document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน"]'))`),'Watchlist search did not render');
    await evaluate(`(()=>{const i=document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(suffix)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitRow();
    const actions=async()=>evaluate(`(()=>{const r=${fixtureRow};return {text:r.innerText,buttons:[...r.querySelectorAll('button')].map(b=>({name:b.getAttribute('aria-label'),disabled:b.disabled})),viewLinks:r.querySelectorAll('a[aria-label^="ดูรายละเอียดเคสของ"]').length};})()`);
    let state=await actions();
    assert(state.text.includes('ยังไม่เปิดเคส'),'Unopened case status missing');
    assert(state.buttons.find(b=>b.name.startsWith('ดูรายละเอียดเคสของ'))?.disabled,'View not disabled before opening');
    assert(state.buttons.find(b=>b.name==='แชร์ลิงก์')?.disabled,'Share not disabled before assignment');
    assert(state.buttons.find(b=>b.name.startsWith('เปิดเคสติดตามนักเรียน'))?.disabled===false,'Manual open unavailable');
    await evaluate(`(${fixtureRow}).querySelector('button[aria-label^="เปิดเคสติดตามนักเรียน"]').click()`);
    await waitFor(()=>evaluate(`Boolean(document.querySelector('#open-case-reason'))`),'Shared open-case dialog missing');
    await waitFor(()=>evaluate(`Boolean(document.querySelector('#open-case-reason')?.value.trim())`),'Open-case reason did not initialize');
    await clickText('เปิดเคส');
    await waitFor(()=>evaluate(`location.pathname.startsWith('/cases/')`),async()=> 'Manual opening did not navigate to case: '+JSON.stringify(await evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');return {path:location.pathname,reasonLength:document.querySelector('#open-case-reason')?.value.length,errors:[...(d?.querySelectorAll('[role="alert"], [data-slot="form-message"]') || [])].map(e=>e.innerText),buttons:[...(d?.querySelectorAll('button') || [])].map(b=>({text:b.innerText,disabled:b.disabled}))};})()`)));
    caseId=Number(await evaluate('location.pathname.split("/").pop()'));
    const assignees=await api('GET',`/tasks/visit-assignees/${student}`);
    const homeroom=assignees.body.data?.find(teacher=>teacher.isHomeroom);
    assert(homeroom,'Homeroom default missing');
    await waitFor(()=>evaluate(`(()=>{const picker=document.querySelector('[aria-label="ครูผู้ได้รับมอบหมาย"]');return Boolean(picker && ((picker.value || picker.innerText || '').includes('ครูประจำชั้น')));})()`),'Default homeroom teacher not rendered');
    const deniedOpen=await api('POST','/cases',{student_id:student,reason:'นอกขอบเขต'},deniedCookie);
    assert([403,404].includes(deniedOpen.status),'Cross-school manual opening was permitted');
    const duplicate=await api('POST','/cases',{student_id:student,reason:'ทดสอบเปิดซ้ำ'});
    assert(duplicate.status===200 && duplicate.body.created===false && Number(duplicate.body.data.id)===caseId,'Duplicate case was created');
    // Exercise the unchanged assignment API used by the shared timeline.
    const now=new Date(),ends=new Date(now.getTime()+86400000);
    const assignment=await api('POST','/tasks',{task_type:'VISIT',type:'VISIT',existing_case_id:String(caseId),student_id:student,
      assigned_teacher_id:Number(homeroom.teacherId),opens_at:now.toISOString(),expires_at:ends.toISOString(),
      expires_value:1,expires_unit:'days'});
    assert([200,201].includes(assignment.status),`Shared assignment failed: HTTP ${assignment.status}`);
    await send('Page.navigate',{url});
    await waitFor(()=>evaluate(`Boolean(document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน"]'))`),'Watchlist reload failed');
    await evaluate(`(()=>{const i=document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(suffix)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitRow();state=await actions();
    assert(state.viewLinks===1 && state.text.includes('รอติดตาม'),'Assigned watchlist case did not show tracking state');
    assert(state.buttons.find(b=>b.name==='แชร์ลิงก์')?.disabled===false,'Share remained disabled after assignment');
    assert(state.buttons.find(b=>b.name.startsWith('เปิดเคสติดตามนักเรียน'))?.disabled,'Duplicate opening remained enabled');
    await evaluate(`(${fixtureRow}).querySelector('button[aria-label="แชร์ลิงก์"]').click()`);
    await waitFor(()=>evaluate(`Boolean(document.querySelector('[role="dialog"]'))`),'Shared link dialog did not open');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await waitFor(()=>evaluate(`!document.querySelector('[role="dialog"]')`),'Share dialog did not close');
    const desktopShot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync('/tmp/sts-watchlist-follow-up-desktop.png',Buffer.from(desktopShot.data,'base64'));
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await waitRow();state=await actions();
    assert(state.viewLinks===1 && state.buttons.find(b=>b.name==='แชร์ลิงก์')?.disabled===false,'Mobile actions differ from desktop');
    assert(state.buttons.find(b=>b.name.startsWith('เปิดเคสติดตามนักเรียน'))?.disabled,'Mobile allows duplicate opening');
    await evaluate(`(${fixtureRow}).scrollIntoView({block:'center'})`);
    await delay(200);
    const mobileShot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync('/tmp/sts-watchlist-follow-up-mobile.png',Buffer.from(mobileShot.data,'base64'));
    await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
    const metrics=[];
    for(const tab of ['risk','watchlist','referrals']){
      await send('Page.navigate',{url:`http://127.0.0.1:5174/student-risk-report/${tab}`});
      await waitFor(()=>evaluate(`(()=>{const values=[...document.querySelectorAll('[data-summary-label] [data-summary-value]')];return location.pathname.endsWith('/${tab}') && values.length>0 && values.every(v=>/คน|เคส/.test(v.textContent)) && Boolean(document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน"]'));})()`),`${tab} summary/search missing or still loading`);
      metrics.push(await evaluate(`(()=>{const r=document.querySelector('[data-summary-label]').getBoundingClientRect();return {tab:'${tab}',top:r.top,height:r.height,left:r.left};})()`));
    }
    assert(metrics.every(r=>Math.abs(r.top-metrics[0].top)<2 && Math.abs(r.left-metrics[0].left)<2 && Math.abs(r.height-metrics[0].height)<2),'Summary card placement/height differs: '+JSON.stringify(metrics));
    for(const status of ['OPEN','IN_PROGRESS','STUDENT_NOT_FOUND','PENDING_REVIEW','AWAITING_REFERRAL','AWAITING_REFERRAL_OUTCOME','RESOLVED']){
      await db.query("UPDATE cases SET status=$1,completion_outcome_code=CASE WHEN $1='RESOLVED' THEN 'CLOSED' ELSE NULL END WHERE id=$2",[status,caseId]);
      await send('Page.navigate',{url:`http://127.0.0.1:5174/cases/${caseId}`});
      await waitFor(()=>evaluate(`(()=>{const steps=[...document.querySelectorAll('[data-flow-step]')];return steps.length>0 && window.__stsLatestScroll===steps.at(-1);})()`),`Latest-step scroll missing for ${status}`);
    }
    console.log('PASS watchlist browser: no auto-case/manual/homeroom/share/scope, desktop/mobile actions, aligned three-tab cards/search, latest-step scroll all seven statuses');
  } finally {
    socket?.close();chrome?.kill('SIGTERM');frontend?.kill('SIGTERM');
    const runner=db.createQueryRunner();await runner.connect();await runner.startTransaction();
    try{
      // Isolated *_smoke fixtures only; retain append-only guards outside cleanup.
      await runner.query("SET LOCAL session_replication_role='replica'");
      const tasks=await runner.query('SELECT id FROM tasks WHERE case_id IN (SELECT id FROM cases WHERE student_uuid=$1)',[student]);
      const taskIds=tasks.map(t=>t.id);
      await runner.query('DELETE FROM notifications WHERE case_id IN (SELECT id FROM cases WHERE student_uuid=$1) OR (ref_entity=\'classroom_student_comments\' AND ref_id=ANY($2::text[]))',[student,commentIds.map(String)]);
      await runner.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::int[])',[ [actorId,deniedId].filter(Boolean) ]);
      await runner.query('DELETE FROM task_links WHERE task_id=ANY($1::uuid[])',[taskIds]);
      await runner.query('DELETE FROM tasks WHERE id=ANY($1::uuid[])',[taskIds]);
      await runner.query('DELETE FROM student_risk_profiles WHERE student_uuid=$1',[student]);
      await runner.query('DELETE FROM cases WHERE student_uuid=$1',[student]);
      await runner.query('DELETE FROM classroom_student_comments WHERE person_uuid=$1',[person]);
      await runner.query('DELETE FROM student_term WHERE student_uuid=$1',[student]);
      await runner.query('DELETE FROM student_person WHERE person_uuid=$1',[person]);
      await runner.query('DELETE FROM users WHERE id=ANY($1::int[]) AND data_origin_code=\'AUTOMATED_TEST\'',[ [actorId,deniedId].filter(Boolean) ]);
      await runner.commitTransaction();
    }catch(error){await runner.rollbackTransaction();throw error;}finally{await runner.release();}
    await app.close();if(profile){await delay(300);fs.rmSync(profile,{recursive:true,force:true});}
  }
}
main().catch(error=>{console.error('FAIL watchlist browser:',error.code||error.name,String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/g,'[REDACTED_URL]'));process.exitCode=1;});

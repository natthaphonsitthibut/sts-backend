/** Local owner-requested case roster; real students/teachers/agencies and normal services.
 * Dry-run by default. --apply consumes an AraID record JSON from stdin (PIN never logged).
 * Re-running resumes the same reason-tagged cases without rotating issued links.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { TaskService } = require('../dist/task/task.service');
const { ReferralLinkService } = require('../dist/task/referral-link.service');
const { AraIdService } = require('../dist/araid/araid.service');
const { AuthActorService } = require('../dist/auth/auth-actor.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { MagicSessionStoreService } = require('../dist/auth/magic-session-store.service');
const { validateOrReject } = require('class-validator');
const { plainToInstance } = require('class-transformer');
const { CreateAraIdRecordDto } = require('../dist/araid/dto/araid.dto');
const APPLY = process.argv.includes('--apply');
const REPAIR_ALL = process.argv.includes('--repair-legacy-all');
const SCHOOL = Number(
  (process.argv.find((a) => a.startsWith('--school=')) || '--school=10010004').split('=')[1],
);
const PREFIX = 'ติดตามการมาเรียนและประสานครอบครัว รอบตุลาคม 2569';
const STATES = [
  ['OPEN', 'รอมอบหมาย'],
  ['IN_PROGRESS', 'รอติดตาม'],
  ['STUDENT_NOT_FOUND', 'ไม่พบนักเรียน'],
  ['PENDING_REVIEW', 'รอพิจารณา'],
  ['AWAITING_REFERRAL', 'รอส่งต่อ'],
  ['AWAITING_REFERRAL_OUTCOME', 'รอผลการส่งต่อ'],
  ['RESOLVED', 'เสร็จสิ้น'],
];
if (process.env.NODE_ENV === 'production' || process.env.DB_NAME !== 'sts') {
  throw new Error('This owner-requested seed is restricted to local DB_NAME=sts');
}
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const db = app.get(DataSource),
      cases = app.get(CaseService),
      tasks = app.get(TaskService);
    if (!['localhost', '127.0.0.1', '::1'].includes(db.options.host)) {
      throw new Error('Case roster preparation requires a local database host');
    }
    const links = app.get(ReferralLinkService),
      ara = app.get(AraIdService);
    const [admin] = await db.query(`SELECT id FROM users WHERE status='ACTIVE' AND role='ADMIN'
      AND data_origin_code <> 'AUTOMATED_TEST' ORDER BY id LIMIT 1`);
    if (!admin) throw new Error('No real active administrator');
    let cookie = '';
    app.get(SessionCookieService).setSession(
      {
        cookie: (name, value) => {
          cookie = `${name}=${encodeURIComponent(value)}`;
        },
      },
      admin.id,
    );
    const actor = await app.get(AuthActorService).loadRequiredUser({ headers: { cookie } });
    if (!actor || !['case:assign', 'case:review'].every((p) => actor.permissions.includes(p)))
      throw new Error('Administrator lacks case permissions');
    const agencies = await db.query(
      `SELECT id,agency_name FROM referral_agencies WHERE is_active ORDER BY id LIMIT 3`,
    );
    if (!agencies.length) throw new Error('No real referral agency');
    const existing = await db.query(
      `SELECT id,status,reason_flagged FROM cases WHERE school_id=$1
      AND deleted_at IS NULL AND reason_flagged LIKE $2 ORDER BY id`,
      [SCHOOL, `${PREFIX}%`],
    );
    const students = await db.query(
      `SELECT s.student_uuid FROM student_term s
      JOIN student_current_enrollment_resolution e ON e.selected_student_uuid=s.student_uuid AND e.resolution_state='ACTIVE'
      WHERE s."SchoolID_Onec"=$1 AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.student_uuid=s.student_uuid AND c.deleted_at IS NULL)
      ORDER BY s.student_uuid LIMIT 21`,
      [SCHOOL],
    );
    if (students.length + existing.length < 21)
      throw new Error('Not enough eligible real students');
    const legacy = await db.query(
      `SELECT c.id, r.id AS referral_id FROM cases c
      JOIN LATERAL (SELECT id FROM case_referrals WHERE case_id=c.id ORDER BY referred_at DESC,id DESC LIMIT 1) r ON true
      WHERE c.school_id=$1 AND c.status='AWAITING_REFERRAL_OUTCOME' AND c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM case_referral_links l WHERE l.case_referral_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM case_referral_results x WHERE x.case_referral_id=r.id)`,
      [SCHOOL],
    );
    console.log(
      JSON.stringify({
        mode: APPLY ? 'apply' : 'dry-run',
        schoolId: SCHOOL,
        states: STATES.map(([status]) => ({ status, count: 3 })),
        existing: existing.length,
        legacyMissingLinks: legacy.length,
      }),
    );
    if (!APPLY) return;
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const record = plainToInstance(CreateAraIdRecordDto, JSON.parse(input));
    await validateOrReject(record, { whitelist: true, forbidNonWhitelisted: true });
    const [identity] = await db.query(
      'SELECT id FROM araid_identity_records WHERE identity_number=$1',
      [record.identityNumber],
    );
    if (!identity) await ara.createRecord(actor.id, record);
    const login = async () => ara.login(record.identityNumber, record.pin);
    await login(); // Fail before writing cases if the supplied PIN is invalid.
    for (const row of legacy)
      await links.cancelReferral(
        Number(row.id),
        row.referral_id,
        {
          cancel_reason:
            'การส่งต่อเดิมไม่มีลิงก์รายงานผล ยกเลิกเพื่อให้โรงเรียนส่งต่อพร้อมลิงก์และรหัสใหม่',
        },
        actor,
      );
    let studentIndex = 0;
    for (const [target, label] of STATES)
      for (let index = 1; index <= 3; index++) {
        const reason = `${PREFIX} — ${label} ${index}`;
        let row = existing.find((c) => c.reason_flagged === reason);
        if (!row) {
          const opened = await cases.openCase(
            { student_id: students[studentIndex++].student_uuid, reason },
            actor,
          );
          if (!opened.created) throw new Error('Student unexpectedly already has a case');
          row = { id: opened.data.id, status: 'OPEN' };
        }
        const id = Number(row.id);
        if (row.status === target) continue;
        if (row.status === 'OPEN' && target !== 'OPEN') {
          const [c] = await db.query('SELECT student_uuid FROM cases WHERE id=$1', [id]);
          const assignees = await app.get(TaskRepository).listVisitAssignees(c.student_uuid);
          const teacher = assignees.find((t) => t.email);
          if (!teacher) throw new Error(`No teacher with email for case ${id}`);
          await tasks.createTask(
            actor,
            {
              task_type: 'VISIT',
              student_id: c.student_uuid,
              existing_case_id: String(id),
              assigned_teacher_id: Number(teacher.teacher_id),
              expires_value: 30,
              expires_unit: 'days',
            },
            'http://localhost:5173',
          );
          row.status = 'IN_PROGRESS';
        }
        if (row.status === 'IN_PROGRESS' && target !== 'IN_PROGRESS') {
          const [link] = await db.query(
            `SELECT l.id,l.token_encrypted FROM task_links l JOIN tasks t ON t.id=l.task_id
          WHERE t.case_id=$1 AND l.status='ACTIVE' ORDER BY l.created_at DESC LIMIT 1`,
            [id],
          );
          if (!link) throw new Error(`No active assignment for case ${id}`);
          const {
            TokenEncryptionService,
          } = require('../dist/common/crypto/token-encryption.service');
          const token = app.get(TokenEncryptionService).decrypt(link.token_encrypted);
          // Administrative preparation of a local roster, not a claimed Google login.
          const session = await app.get(MagicSessionStoreService).issue(String(link.id));
          await tasks.saveTaskSubmission(
            token,
            {
              visited_at: new Date().toISOString(),
              home_visit_exception_code:
                target === 'STUDENT_NOT_FOUND' ? 'STUDENT_NOT_FOUND' : null,
              cause_detail:
                target === 'STUDENT_NOT_FOUND'
                  ? 'ลงพื้นที่ตามที่อยู่และสอบถามผู้ปกครอง ยังไม่พบนักเรียน นัดประสานครอบครัวอีกครั้ง'
                  : 'ได้พบครอบครัว นักเรียนมีข้อจำกัดด้านการเดินทาง ต้องประสานความช่วยเหลือ',
              recommendation: 'ประสานครูที่ปรึกษาและติดตามการมาเรียนภายใน 30 วัน',
            },
            session,
          );
          row.status = target === 'STUDENT_NOT_FOUND' ? 'STUDENT_NOT_FOUND' : 'PENDING_REVIEW';
        }
        const referralTarget = [
          'AWAITING_REFERRAL',
          'AWAITING_REFERRAL_OUTCOME',
          'RESOLVED',
        ].includes(target);
        if (row.status === 'PENDING_REVIEW' && referralTarget) {
          await cases.reviewCase(
            id,
            {
              review_action: 'REFER_AGENCY',
              review_note: 'ประสานหน่วยงานช่วยเหลือครอบครัวและการเดินทางมาเรียน',
            },
            actor,
          );
          row.status = 'AWAITING_REFERRAL';
        }
        if (row.status === 'AWAITING_REFERRAL' && target !== 'AWAITING_REFERRAL') {
          const agency = agencies[(index - 1) % agencies.length];
          await links.sendReferral(
            id,
            {
              referral_agency_id: Number(agency.id),
              referral_note: `ประสาน ${agency.agency_name} เพื่อวางแผนช่วยเหลือนักเรียนและครอบครัว`,
              starts_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
            },
            actor,
          );
          row.status = 'AWAITING_REFERRAL_OUTCOME';
        }
        if (row.status === 'AWAITING_REFERRAL_OUTCOME' && target === 'RESOLVED') {
          const detail = await cases.getCase(id, actor),
            referral = detail.data.referrals[0];
          const code = (await links.getAccessCode(id, referral.id, actor)).data.access_code;
          const token = referral.link.url.split('/referral-report/')[1];
          const challenge = (
            await links.createAraIdChallenge(token, { access_code: code }, 'http://localhost:5173')
          ).data;
          const auth = await links.beginAraIdChallenge(challenge.challengeToken);
          const profile = await login();
          await links.approveAraIdChallenge(auth.authorizationToken, profile.profileId, Date.now());
          const verified = await links.pollAraIdChallenge(challenge.challengeToken);
          await links.submitReport(
            token,
            {
              result_code: 'SUCCEEDED',
              action_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(
                new Date(),
              ),
              result_note:
                'ประสานครอบครัวและจัดการเดินทางเรียบร้อย นักเรียนกลับมาเรียนต่อเนื่องแล้ว',
            },
            verified.data.sessionToken,
          );
          await cases.reviewCase(
            id,
            { review_action: 'CLOSE', review_note: 'ตรวจผลหน่วยงานและการกลับมาเรียนแล้ว ปิดเคส' },
            actor,
          );
          row.status = 'RESOLVED';
        }
        const [saved] = await db.query('SELECT status FROM cases WHERE id=$1', [id]);
        if (saved.status !== target) throw new Error(`Case ${id} did not reach ${target}`);
        console.log(`case ${id}: ${target}`);
      }
    // Owner-authorized local presentation repair. Preserve school recorder FK,
    // do not invent historical AraID verification or attach a new link to old reports.
    const repaired = await db.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT x.case_referral_id,x.result_note,x.recorded_by_user_id,x.action_date
        FROM case_referral_results x JOIN case_referrals r ON r.id=x.case_referral_id JOIN cases c ON c.id=r.case_id
        WHERE (c.school_id=$1 OR $2) AND x.result_note LIKE 'บันทึกย้อนหลังโดยระบบ:%' FOR UPDATE OF x`,
        [SCHOOL, REPAIR_ALL],
      );
      if (rows.length) {
        const { writeFileSync } = require('fs');
        writeFileSync(`/tmp/sts-referral-legacy-before-${Date.now()}.json`, JSON.stringify(rows), {
          mode: 0o600,
          flag: 'wx',
        });
        await manager.query(
          `UPDATE case_referral_results x SET recorded_by_user_id=COALESCE(x.recorded_by_user_id,r.referred_by_user_id,$2),
          action_date=COALESCE(x.action_date,(x.recorded_at AT TIME ZONE 'Asia/Bangkok')::date),
          result_note=CASE WHEN r.status_code='NOT_SUCCEEDED' THEN 'ประสานครอบครัวแล้ว ยังไม่สามารถจัดความช่วยเหลือได้ ต้องติดตามและประสานหน่วยงานเพิ่มเติม'
            ELSE 'หน่วยงานประสานครอบครัวและจัดความช่วยเหลือเรียบร้อย นักเรียนสามารถกลับมาเรียนต่อได้' END
          FROM case_referrals r JOIN cases c ON c.id=r.case_id
          WHERE x.case_referral_id=r.id AND (c.school_id=$1 OR $3) AND x.result_note LIKE 'บันทึกย้อนหลังโดยระบบ:%'`,
          [SCHOOL, actor.id, REPAIR_ALL],
        );
      }
      return rows.length;
    });
    console.log(
      JSON.stringify({
        legacyReportsPrepared: repaired,
        counts: await db.query(
          `SELECT status,count(*)::int AS count FROM cases WHERE school_id=$1 AND deleted_at IS NULL AND reason_flagged LIKE $2 GROUP BY status ORDER BY status`,
          [SCHOOL, `${PREFIX}%`],
        ),
      }),
    );
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error(
    'Case roster preparation failed; inspect the current case IDs before resuming (credentials withheld).',
  );
  process.exitCode = 1;
});

/** Owner-authorized local presentation data. Reuses real FK-backed cases and
 * authors comments as each student's real homeroom teacher. No new cases,
 * accounts, fake reports, or status changes. Dry-run by default; --apply writes.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SchoolStructureService } = require('../dist/school-structure/school-structure.service');
const { AuditLogService } = require('../dist/audit-log/audit-log.service');
const APPLY = process.argv.includes('--apply');
const NORMALIZE_REASONS = process.argv.includes('--normalize-reasons');
const USE_RECORDED_CAUSES = process.argv.includes('--use-recorded-causes');
// A case's reason is what was seen before it was opened (owner, 2026-10-15).
// --use-recorded-causes wrote a home-visit finding there, which reads as an
// outcome rather than a reason.
const USE_OPENING_REASONS = process.argv.includes('--use-opening-reasons');
const ROSTER_CASE_IDS = Array.from({length:21},(_,index)=>3354+index);
const SCHOOL = Number((process.argv.find(a=>a.startsWith('--school=')) || '--school=10010004').split('=')[1]);
const PREFIX = 'ติดตามการมาเรียนและประสานครอบครัว รอบตุลาคม 2569';
const SCENARIOS = {
  OPEN: ['WATCH','ATTENDANCE','พบการมาเรียนไม่สม่ำเสมอและขาดการติดต่อกับครู ควรประสานครอบครัวเพื่อทราบข้อจำกัดและวางแผนติดตาม'],
  IN_PROGRESS: ['WATCH','ACADEMIC','งานที่ได้รับมอบหมายยังไม่ครบและขาดเรียนบางช่วง ครูประจำชั้นกำลังประสานผู้ปกครองและติดตามที่บ้าน'],
  STUDENT_NOT_FOUND: ['CONCERN','FAMILY_CARE','ไม่พบนักเรียนตามที่อยู่ที่แจ้งไว้ และยังติดต่อผู้ปกครองไม่ได้ ต้องประสานคนในชุมชนเพื่อยืนยันที่อยู่และความปลอดภัย'],
  PENDING_REVIEW: ['WATCH','FINANCIAL','ครอบครัวมีข้อจำกัดด้านค่าเดินทาง ครูได้เยี่ยมบ้านและส่งรายงานให้โรงเรียนพิจารณาความช่วยเหลือแล้ว'],
  AWAITING_REFERRAL: ['CONCERN','EMOTIONAL','พบความเครียดและการถอนตัวจากกิจกรรมในห้องเรียน โรงเรียนพิจารณาประสานหน่วยงานที่ดูแลด้านสุขภาพและครอบครัว'],
  AWAITING_REFERRAL_OUTCOME: ['CONCERN','HEALTH','นักเรียนมีข้อจำกัดด้านสุขภาพที่กระทบการมาเรียน โรงเรียนส่งต่อให้หน่วยงานที่รับผิดชอบและกำลังรอผลการดูแล'],
  RESOLVED: ['NOTE','ATTENDANCE','ครูติดตามร่วมกับผู้ปกครองและประสานความช่วยเหลือแล้ว นักเรียนกลับมาเรียนสม่ำเสมอ เก็บผลการติดตามไว้ในประวัติ'],
};
// What a teacher saw that led to each roster case, written before any visit.
const OPENING_REASONS = {
  OPEN: 'ขาดเรียนบ่อยและติดต่อครูไม่ได้ ควรประสานครอบครัวเพื่อทราบสาเหตุ',
  IN_PROGRESS: 'ส่งงานไม่ครบและขาดเรียนบางช่วง ควรติดตามที่บ้านร่วมกับผู้ปกครอง',
  STUDENT_NOT_FOUND: 'ขาดเรียนต่อเนื่องและติดต่อผู้ปกครองไม่ได้ ควรเยี่ยมบ้านเพื่อยืนยันความปลอดภัย',
  PENDING_REVIEW: 'มาเรียนไม่สม่ำเสมอ ครูสังเกตว่าครอบครัวอาจมีปัญหาค่าเดินทาง ควรเยี่ยมบ้าน',
  AWAITING_REFERRAL: 'เก็บตัวและไม่ร่วมกิจกรรมในห้องเรียน ควรติดตามเรื่องความเครียด',
  AWAITING_REFERRAL_OUTCOME: 'ขาดเรียนบ่อยจากอาการเจ็บป่วย ควรประสานครอบครัวเรื่องการดูแลสุขภาพ',
  RESOLVED: 'ขาดเรียนบ่อย ควรประสานผู้ปกครองเพื่อติดตามการมาเรียน',
};
// Roster cases come in threes per original status, in SCENARIOS order; a case
// may have moved on since, so its opening reason follows its roster group.
const openingReasonFor=(row)=>{
  const index=ROSTER_CASE_IDS.indexOf(Number(row.id));
  return index<0?undefined:OPENING_REASONS[Object.keys(SCENARIOS)[Math.floor(index/3)]];
};
async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.DB_NAME !== 'sts') throw new Error('Only local DB_NAME=sts is allowed');
  const app = await NestFactory.createApplicationContext(AppModule,{logger:false});
  try {
    const db=app.get(DataSource);
    if (!['localhost','127.0.0.1','::1'].includes(db.options.host)) throw new Error('Only local database hosts are allowed');
    const categories=await db.query('SELECT code FROM classroom_student_problem_categories WHERE is_active=TRUE');
    const levels=await db.query('SELECT code FROM classroom_student_comment_concern_levels WHERE is_active=TRUE');
    for(const [level,category] of Object.values(SCENARIOS)){
      if(!categories.some(row=>row.code===category) || !levels.some(row=>row.code===level))
        throw new Error('A required active comment category or concern level is missing');
    }
    const rows=await db.query(`SELECT c.id,c.status,c.student_uuid,s.classroom_id,
      homeroom.teacher_id,homeroom.teacher_name,c.reason_flagged,
      COALESCE(NULLIF(TRIM(visit.cause_detail),''),NULLIF(TRIM(observation.problem_description),'')) AS recorded_cause
      FROM cases c JOIN student_term s ON s.student_uuid=c.student_uuid AND s.deleted_at IS NULL
      JOIN student_current_enrollment_resolution current_enrollment ON current_enrollment.selected_student_uuid=s.student_uuid
        AND current_enrollment.resolution_state='ACTIVE'
      JOIN LATERAL (SELECT teacher.id::text AS teacher_id,
        TRIM(concat_ws(' ',teacher.first_name,teacher.last_name)) AS teacher_name
        FROM classroom_homeroom_teacher_assignments assignment
        JOIN school_teacher_memberships membership ON membership.id=assignment.teacher_membership_id
          AND membership.school_id=c.school_id AND membership.membership_status='ACTIVE' AND membership.deleted_at IS NULL
        JOIN teachers teacher ON teacher.id=membership.teacher_id AND teacher.teacher_status='ACTIVE' AND teacher.deleted_at IS NULL
        WHERE assignment.classroom_id=s.classroom_id
        ORDER BY assignment.is_primary DESC,membership.id LIMIT 1) homeroom ON TRUE
      LEFT JOIN LATERAL (SELECT submission.cause_detail FROM tasks task
        JOIN task_links link ON link.task_id=task.id
        JOIN task_submissions submission ON submission.task_link_id=link.id
        WHERE task.case_id=c.id AND task.deleted_at IS NULL AND submission.deleted_at IS NULL
          AND submission.home_visit_exception_code IS NULL
        ORDER BY submission.created_at DESC,submission.id DESC LIMIT 1) visit ON TRUE
      LEFT JOIN LATERAL (SELECT comment.problem_description FROM classroom_student_comments comment
        WHERE comment.person_uuid=s.person_uuid AND comment.classroom_id=s.classroom_id
        ORDER BY comment.created_at DESC,comment.id DESC LIMIT 1) observation ON TRUE
      WHERE c.school_id=$1 AND c.deleted_at IS NULL AND (c.reason_flagged LIKE $2 OR c.id=ANY($3::int[]))
        AND c.id=(SELECT latest.id FROM cases latest WHERE latest.student_uuid=c.student_uuid AND latest.deleted_at IS NULL
          ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
      ORDER BY c.id`,[SCHOOL,`${PREFIX}%`,ROSTER_CASE_IDS]);
    const counts={};for(const row of rows)counts[row.status]=(counts[row.status] || 0)+1;
    if(USE_OPENING_REASONS){
      if(rows.length!==ROSTER_CASE_IDS.length || rows.some(row=>!openingReasonFor(row)))throw new Error('A case status has no opening reason');
    }else if(Object.keys(SCENARIOS).some(status=>(counts[status] || 0)<3)) throw new Error('Existing real workflow roster must contain three current cases per status with valid homeroom FKs');
    if(USE_RECORDED_CAUSES && rows.some(row=>!row.recorded_cause))throw new Error('A case has no recorded cause; correction stopped');
    const reasonsToNormalize=USE_OPENING_REASONS?rows.filter(row=>row.reason_flagged!==openingReasonFor(row)):
      USE_RECORDED_CAUSES?rows.filter(row=>row.reason_flagged!==row.recorded_cause):
      NORMALIZE_REASONS?rows.filter(row=>row.reason_flagged.startsWith(`${PREFIX} — `) &&
        / — (รอมอบหมาย|รอติดตาม|ไม่พบนักเรียน|รอพิจารณา|รอส่งต่อ|รอผลการส่งต่อ|เสร็จสิ้น) [123]$/.test(row.reason_flagged)):[];
    if(APPLY && reasonsToNormalize.length){
      const [actor]=await db.query(`SELECT id,TRIM(concat_ws(' ',"FirstName","LastName")) AS label FROM users WHERE status='ACTIVE' AND role='ADMIN'
        AND data_origin_code IS DISTINCT FROM 'AUTOMATED_TEST' ORDER BY id LIMIT 1`);
      if(!actor)throw new Error('Need a real administrator for the correction audit');
      await db.transaction(async manager=>{
        for(const row of reasonsToNormalize){
          const reason=USE_OPENING_REASONS?openingReasonFor(row):USE_RECORDED_CAUSES?row.recorded_cause:PREFIX;
          const changed=await manager.query(`WITH corrected AS (
            UPDATE cases SET reason_flagged=$1,updated_at=NOW()
            WHERE id=$2 AND school_id=$3 AND reason_flagged=$4 RETURNING id
          ) SELECT id FROM corrected`,[reason,row.id,SCHOOL,row.reason_flagged]);
          if(changed.length!==1)throw new Error('Case reason changed concurrently');
          await app.get(AuditLogService).recordAtomic({actorUserId:actor.id,actorLabel:actor.label,action:'MASTER_DATA_EDIT',
            targetType:'cases',targetId:String(row.id),metadata:{op:'normalize-prepared-case-reason',
              previousReason:row.reason_flagged,reason,schoolId:SCHOOL},ip:null},manager);
        }
      });
    }
    let planned=0,kept=0;const commentIds=[];
    // Rewriting reasons only: observations stay as they are.
    for(const row of USE_OPENING_REASONS?[]:rows){
      const [level,category,text]=SCENARIOS[row.status] || [];
      if(!text)continue;
      const [existing]=await db.query(`SELECT comment.id FROM classroom_student_comments comment
        JOIN student_term enrollment ON enrollment.person_uuid=comment.person_uuid AND enrollment.classroom_id=comment.classroom_id
        WHERE enrollment.student_uuid=$1 AND comment.problem_description=$2 AND comment.concern_level_code=$3
          AND comment.problem_category_code=$4 AND comment.authored_by_teacher_id=$5 LIMIT 1`,[row.student_uuid,text,level,category,row.teacher_id]);
      if(existing){kept++;commentIds.push(Number(existing.id));continue;}
      planned++;
      if(APPLY){const created=await app.get(SchoolStructureService).createStudentCommentFromLink(Number(row.classroom_id),row.student_uuid,
        {problemCategory:category,concernLevelCode:level,problemDescription:text},
        {teacherId:row.teacher_id,displayName:row.teacher_name});
        commentIds.push(Number(created.data.id));}
    }
    if(APPLY){
      const after=await db.query('SELECT id,status FROM cases WHERE id=ANY($1::int[]) ORDER BY id',[rows.map(row=>Number(row.id))]);
      if(JSON.stringify(after.map(row=>[Number(row.id),row.status]))!==JSON.stringify(rows.map(row=>[Number(row.id),row.status])))
        throw new Error('Existing case statuses changed during preparation');
      const [authors]=await db.query(`SELECT COUNT(*)::int AS valid_authors FROM classroom_student_comments comment
        JOIN teachers teacher ON teacher.id=comment.authored_by_teacher_id
        JOIN school_classrooms classroom ON classroom.id=comment.classroom_id
        JOIN student_person person ON person.person_uuid=comment.person_uuid
        WHERE comment.id=ANY($1::int[]) AND classroom.school_id=$2
          AND comment.authored_by_user_id IS NULL AND teacher.first_name IS NOT NULL`,[commentIds,SCHOOL]);
      if(Number(authors.valid_authors)!==commentIds.length)throw new Error('Prepared comments have missing real authors or FK relationships');
    }
    console.log(JSON.stringify({mode:APPLY?'apply':'dry-run',schoolId:SCHOOL,states:counts,addComments:planned,existingComments:kept,
      caseIds:rows.map(r=>Number(r.id)),commentIds,normalizeReasons:reasonsToNormalize.length,caseStatusChanged:false,newAccounts:0,systemAuthors:0}));
  }finally{await app.close();}
}
main().catch(error=>{console.error('Watchlist local preparation failed:',error.code || error.name,
  error.message==='Need a real administrator for the correction audit'?'Missing real administrator':
  error.message==='Case reason changed concurrently'?'Case reason changed concurrently':
  error.message==='Existing case statuses changed during preparation'?'Case status changed':
  error.message==='A case status has no opening reason'?'Missing opening reason':
  error.message==='Existing real workflow roster must contain three current cases per status with valid homeroom FKs'?'Roster incomplete':
  error.message==='Only local DB_NAME=sts is allowed' || error.message==='Only local database hosts are allowed'?'Local sts database only':'');process.exitCode=1;});

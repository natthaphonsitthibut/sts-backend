/**
 * End-to-end check of the assistance phase: a follow-up review can send a case
 * into ให้ความช่วยเหลือ, the assistance round is assignable and reportable, and
 * the assistance review offers only ปิดเคส / ส่งต่อหน่วยงาน.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');
const { CaseTrackingOptionsService } = require('../dist/task/case-tracking-options.service');
const { TaskLifecycleService } = require('../dist/task/task-lifecycle.service');
const { TaskRepository } = require('../dist/task/task.repository');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run case assistance smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME = 'case_assistance_smoke_reviewer';
const REASON = 'Automated case assistance smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const caseService = app.get(CaseService);
  const lifecycle = app.get(TaskLifecycleService);
  const trackingOptions = app.get(CaseTrackingOptionsService);
  const taskRepository = app.get(TaskRepository);

  let caseId = null;
  let actorId = null;
  const createdTaskIds = [];

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid,
              enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       INNER JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       INNER JOIN student_current_enrollment_resolution resolution
          ON resolution.selected_student_uuid = enrollment.student_uuid
         AND resolution.resolution_state = 'ACTIVE'
       INNER JOIN classroom_teacher_assignments assignment
          ON assignment.classroom_id = enrollment.classroom_id
         AND assignment.deleted_at IS NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM cases existing
         WHERE existing.student_uuid = enrollment.student_uuid
           AND existing.deleted_at IS NULL
           AND existing.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
       )
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
    );
    assert(enrollment, 'need one canonical student whose classroom has a teacher');

    const permissions = JSON.stringify(['dashboard', 'students']);
    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Assistance', 'Smoke', 'ACTIVE', $2::jsonb, 'ADMIN', $3::jsonb, FALSE,
         'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, permissions, JSON.stringify({ school_ids: [Number(enrollment.school_id)] })],
    );
    actorId = Number(actor.id);
    const reviewer = {
      id: actorId,
      username: USERNAME,
      FirstName: 'Assistance',
      LastName: 'Smoke',
      roles: ['ADMIN'],
      permissions: ['dashboard', 'students'],
      data_scope: { school_ids: [Number(enrollment.school_id)] },
    };

    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code, data_origin_code)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_REVIEW', 'FOLLOW_UP', 'AUTOMATED_TEST')
       RETURNING id`,
      [
        enrollment.student_uuid,
        enrollment.student_name,
        enrollment.school_id,
        enrollment.school_name,
        REASON,
      ],
    ).catch(async (error) => {
      // `data_origin_code` is not on every deployment of `cases`; fall back.
      if (!/column "data_origin_code"/.test(error.message)) throw error;
      return await dataSource.query(
        `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
           status, workflow_phase_code)
         VALUES ($1, $2, $3, $4, $5, 'PENDING_REVIEW', 'FOLLOW_UP')
         RETURNING id`,
        [
          enrollment.student_uuid,
          enrollment.student_name,
          enrollment.school_id,
          enrollment.school_name,
          REASON,
        ],
      );
    });
    caseId = Number(createdCase.id);

    // 1. The follow-up review offers ASSIST; the assistance review must not.
    const followUpActions = await trackingOptions.getOptions('FOLLOW_UP');
    const assistanceActions = await trackingOptions.getOptions('ASSISTANCE');
    assert(
      followUpActions.reviewActions.some((action) => action.code === 'ASSIST'),
      'follow-up review is missing the ASSIST action',
    );
    assert(
      !assistanceActions.reviewActions.some((action) => action.code === 'ASSIST'),
      'assistance review must not offer ASSIST again',
    );
    assert(
      ['CLOSE', 'REFER_AGENCY'].every((code) =>
        assistanceActions.reviewActions.some((action) => action.code === code),
      ),
      'assistance review must still offer ปิดเคส and ส่งต่อหน่วยงาน',
    );
    assert(
      followUpActions.assistanceMeasures.length >= 5,
      'assistance measures catalogue is not seeded',
    );

    // 2. ASSIST moves the case back to OPEN inside the assistance phase.
    const assisted = await caseService.reviewCase(
      caseId,
      { review_action: 'ASSIST', review_note: 'ควรให้ทุนการศึกษาและอุปกรณ์การเรียน' },
      reviewer,
    );
    assert(assisted.case_status === 'OPEN', `ASSIST left status ${assisted.case_status}`);
    const [afterAssist] = await dataSource.query(
      `SELECT status, workflow_phase_code FROM cases WHERE id = $1`,
      [caseId],
    );
    assert(
      afterAssist.status === 'OPEN' && afterAssist.workflow_phase_code === 'ASSISTANCE',
      `case did not enter the assistance phase: ${JSON.stringify(afterAssist)}`,
    );

    const detail = await caseService.getCase(caseId, reviewer);
    assert(
      detail.data.display_status_label === 'รอมอบหมาย : ให้ความช่วยเหลือ',
      `unexpected display label ${detail.data.display_status_label}`,
    );

    // 3. A second ASSIST must be refused now that the case left FOLLOW_UP.
    await dataSource.query(`UPDATE cases SET status = 'PENDING_REVIEW' WHERE id = $1`, [caseId]);
    let refused = false;
    try {
      await caseService.reviewCase(
        caseId,
        { review_action: 'ASSIST', review_note: 'ช่วยเหลือรอบสอง' },
        reviewer,
      );
    } catch (error) {
      refused = /ขั้นตอนปัจจุบัน/.test(error.message);
    }
    assert(refused, 'ASSIST was accepted twice on the same case');
    await dataSource.query(`UPDATE cases SET status = 'OPEN' WHERE id = $1`, [caseId]);

    // 4. Assigning the assistance round records the chosen measures.
    const assignees = await taskRepository.listVisitAssignees(enrollment.student_uuid);
    assert(assignees.length > 0, 'no teacher available to receive the assistance round');
    const created = await lifecycle.createTask(
      reviewer,
      {
        task_type: 'ASSIST',
        assigned_teacher_id: Number(assignees[0].teacher_id),
        assistance_measure_codes: ['SCHOLARSHIP', 'OTHER'],
        assistance_measure_detail: 'ประสานกองทุนของโรงเรียน',
        existing_case_id: String(caseId),
        student_id: enrollment.student_uuid,
        expires_value: 1,
        expires_unit: 'days',
        target_school_id: enrollment.school_id,
      },
      'http://127.0.0.1:3000',
    );
    const taskId = created.task_id || created.taskId;
    assert(taskId, 'assistance assignment did not return a task id');
    createdTaskIds.push(taskId);
    const measureRows = await dataSource.query(
      `SELECT assistance_measure_code FROM task_assistance_measures WHERE task_id = $1 ORDER BY 1`,
      [taskId],
    );
    assert(
      measureRows.map((row) => row.assistance_measure_code).join(',') === 'OTHER,SCHOLARSHIP',
      `measures were not persisted: ${JSON.stringify(measureRows)}`,
    );
    const [taskRow] = await dataSource.query(
      `SELECT task_type, assistance_measure_detail FROM tasks WHERE id = $1`,
      [taskId],
    );
    assert(taskRow.task_type === 'ASSIST', `task_type was ${taskRow.task_type}`);
    assert(
      taskRow.assistance_measure_detail === 'ประสานกองทุนของโรงเรียน',
      'OTHER detail was not persisted',
    );

    // 5. Measures marked requires_detail cannot be assigned without the detail.
    let detailEnforced = false;
    try {
      await trackingOptions.getAssistanceMeasures(['OTHER'], null);
    } catch (error) {
      detailEnforced = /รายละเอียดมาตรการ/.test(error.message);
    }
    assert(detailEnforced, 'OTHER measure was accepted without a detail');

    // 6. Reporting the round sends the case to review inside the same phase.
    const [link] = await dataSource.query(
      `SELECT id FROM task_links WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [taskId],
    );
    assert(link, 'assistance assignment did not create a link');
    await taskRepository.insertTaskSubmission({
      linkId: String(link.id),
      visitLat: null,
      visitLng: null,
      visitedAt: null,
      causeCategory: null,
      followUpAssessmentCode: null,
      parentalStatusCode: null,
      guardianTypeCode: null,
      guardianTypeDetail: null,
      residenceEnvironmentCodes: [],
      residenceEnvironmentDetail: null,
      causeDetail: null,
      recommendation: null,
      photoPaths: null,
      addressChanged: false,
      homeVisitExceptionCode: null,
      updatedStudentAddress: null,
      updatedAddressLine: null,
      updatedAddressProvince: null,
      updatedAddressDistrict: null,
      updatedAddressSubDistrict: null,
      updatedPostalCode: null,
      updatedLat: null,
      updatedLng: null,
      caseFollowUpDecision: 'REQUEST_REVIEW',
      caseResolutionOutcomeCode: null,
      assistedAt: new Date().toISOString(),
      assistanceDetail: 'มอบทุนการศึกษา 2,000 บาท และสมุด/อุปกรณ์',
    });
    await dataSource.query(`UPDATE cases SET status = 'PENDING_REVIEW' WHERE id = $1`, [caseId]);

    const rounds = await caseService.getCase(caseId, reviewer);
    const assistanceRound = (rounds.data.follow_up_rounds ?? []).find(
      (round) => round.task_type === 'ASSIST',
    );
    assert(assistanceRound, 'assistance round is missing from the case detail');
    assert(
      assistanceRound.assistance_detail === 'มอบทุนการศึกษา 2,000 บาท และสมุด/อุปกรณ์',
      'assistance detail did not round-trip',
    );
    assert(
      assistanceRound.assistance_measures.map((measure) => measure.code).sort().join(',') ===
        'OTHER,SCHOLARSHIP',
      'assistance measures did not round-trip to the case detail',
    );

    // 7. Closing from the assistance review keeps the phase for history.
    const closed = await caseService.reviewCase(
      caseId,
      { review_action: 'CLOSE', review_note: 'ช่วยเหลือเรียบร้อย ปิดเคส' },
      reviewer,
    );
    assert(closed.case_status === 'RESOLVED', `CLOSE left status ${closed.case_status}`);
    const [final] = await dataSource.query(
      `SELECT status, completion_outcome_code, workflow_phase_code FROM cases WHERE id = $1`,
      [caseId],
    );
    assert(
      final.status === 'RESOLVED' &&
        final.completion_outcome_code === 'CLOSED' &&
        final.workflow_phase_code === 'ASSISTANCE',
      `unexpected final case state: ${JSON.stringify(final)}`,
    );

    console.log('case assistance smoke passed (ASSIST → assign → report → review → close)');
  } finally {
    if (caseId) {
      for (const taskId of createdTaskIds) {
        await dataSource
          .query(
            `DELETE FROM task_submissions WHERE task_link_id IN
               (SELECT id FROM task_links WHERE task_id = $1)`,
            [taskId],
          )
          .catch(() => undefined);
        await dataSource
          .query(`DELETE FROM task_links WHERE task_id = $1`, [taskId])
          .catch(() => undefined);
        await dataSource
          .query(`DELETE FROM task_assistance_measures WHERE task_id = $1`, [taskId])
          .catch(() => undefined);
        await dataSource.query(`DELETE FROM tasks WHERE id = $1`, [taskId]).catch(() => undefined);
      }
      await dataSource
        .query(`DELETE FROM notifications WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource
        .query(`DELETE FROM case_reviews WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource.query(`DELETE FROM tasks WHERE case_id = $1`, [caseId]).catch(() => undefined);
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [caseId]).catch(() => undefined);
    }
    if (actorId) {
      await dataSource
        .query(`DELETE FROM users WHERE id = $1`, [actorId])
        .catch(() => undefined);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

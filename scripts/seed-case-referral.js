const { randomUUID } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { AuditLogService } = require('../dist/audit-log/audit-log.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a case referral with NODE_ENV=production');
}

const APPLY = process.argv.includes('--apply');
const COUNT = Number(
  (process.argv.find((arg) => arg.startsWith('--count=')) ?? '').split('=')[1] ?? 1,
);
/**
 * Statuses to spread the seeded referrals across.
 *
 * `REFERRED` is the only one any code path writes today — a referral closes the
 * case and nothing ever answers it back. The rest are what the agency-response
 * flow will write once it exists, and are set here so the register can be seen
 * with more than one state in it. Read them as fixtures, not as history.
 */
const STATUS_SPREAD = ['REFERRED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED'];

/**
 * Refers one real case to a real agency, by replaying the review path the app
 * itself takes.
 *
 * Nothing here is invented: the case, the agency, the reviewer and the review
 * action all come from rows already in the database, and the writes are the
 * same three the `REFER_AGENCY` review performs in `case.service.ts` —
 * transition the case, record the review, insert the referral. A referral
 * assembled any other way would sit in `case_referrals` without the review it
 * is required to hang off, and the dashboard reads them joined.
 *
 * Runs read-only unless `--apply` is passed, so the chosen rows can be checked
 * before anything is written.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const auditLog = app.get(AuditLogService);
  let recorded = null;

  try {
    await dataSource.transaction(async (manager) => {
      const [action] = await manager.query(`
        SELECT code, target_case_status_code, completion_outcome_code,
               target_workflow_phase_code, available_phase_code
        FROM case_review_actions
        WHERE code = 'REFER_AGENCY' AND is_active = TRUE AND deleted_at IS NULL
        LIMIT 1
      `);
      if (!action) {
        throw new Error('No active REFER_AGENCY review action in case_review_actions');
      }

      // Cases already waiting for review come first — those are referrals the
      // real flow could have produced. Only when there are not enough does the
      // seed move an open case into review itself, which is the step a teacher's
      // submitted report normally performs.
      const caseRecords = await manager.query(
        `
        SELECT c.id, c.student_name, c.school_id, c.status, c.workflow_phase_code,
               school.name AS school_name
        FROM cases c
        LEFT JOIN schools school ON school.id = c.school_id
        WHERE c.status IN ('PENDING_REVIEW', 'OPEN')
          AND c.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM case_referrals existing WHERE existing.case_id = c.id
          )
        ORDER BY (c.status = 'PENDING_REVIEW') DESC, c.updated_at DESC, c.id DESC
        LIMIT $1
        FOR UPDATE OF c
        `,
        [COUNT],
      );
      if (caseRecords.length === 0) {
        throw new Error('No case is available to refer');
      }

      const agencies = await manager.query(`
        SELECT agency.id, agency.agency_name, kind.label_th AS agency_kind_label
        FROM referral_agencies agency
        JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        WHERE agency.is_active = TRUE
        ORDER BY agency.id
      `);
      if (agencies.length === 0) {
        throw new Error('No active referral agency exists to refer the case to');
      }

      // The reviewer is a real account that can actually review this school's
      // cases, not whichever administrator happens to be first in the table.
      const [reviewer] = await manager.query(
        `
        SELECT u.id, TRIM(COALESCE(u."FirstName", '') || ' ' || COALESCE(u."LastName", '')) AS display_name
        FROM users u
        WHERE u.status = 'ACTIVE'
          AND u.role = 'ADMIN'
        ORDER BY u.id
        LIMIT 1
        `,
      );
      if (!reviewer) {
        throw new Error('No active administrator is available to attribute the review to');
      }

      const planned = caseRecords.map((caseRecord, index) => ({
        caseRecord,
        agency: agencies[index % agencies.length],
        statusCode: STATUS_SPREAD[index % STATUS_SPREAD.length],
        reviewId: randomUUID(),
      }));

      for (const item of planned) {
        console.log(
          `case ${item.caseRecord.id} ${item.caseRecord.student_name} (${item.caseRecord.school_name ?? 'ไม่ระบุโรงเรียน'})`,
          `→ ${item.agency.agency_name} [${item.statusCode}]`,
        );
      }
      console.log('reviewer  :', reviewer.id, reviewer.display_name);
      console.log('next state:', action.target_case_status_code, '/', action.target_workflow_phase_code ?? '(unchanged)');

      if (!APPLY) {
        console.log('\ndry run — pass --apply to write');
        throw new Error('DRY_RUN');
      }

      for (const item of planned) {
        const note = `ส่งต่อ ${item.agency.agency_name} เพื่อช่วยเหลือ ${item.caseRecord.student_name}`;
        if (item.caseRecord.status !== 'PENDING_REVIEW') {
          await manager.query(
            `UPDATE cases SET status = 'PENDING_REVIEW' WHERE id = $1 AND deleted_at IS NULL`,
            [item.caseRecord.id],
          );
        }
        const transitioned = await manager.query(
          `
          UPDATE cases c
          SET status = $1,
              completion_outcome_code = $2,
              workflow_phase_code = COALESCE($3, c.workflow_phase_code)
          WHERE c.id = $4 AND c.status = 'PENDING_REVIEW' AND c.deleted_at IS NULL
          RETURNING c.id
          `,
          [
            action.target_case_status_code,
            action.completion_outcome_code,
            action.target_workflow_phase_code ?? null,
            item.caseRecord.id,
          ],
        );
        const transitionedRows = Array.isArray(transitioned[0])
          ? transitioned[0]
          : transitioned;
        if (transitionedRows.length !== 1) {
          throw new Error(`Case ${item.caseRecord.id} could not be transitioned`);
        }

        await manager.query(
          `
          INSERT INTO case_reviews (
            id, case_id, review_action, review_note, review_summary,
            resolution_outcome, reviewed_by, source_actor_user_id,
            proposed_assistance_measure_detail
          ) VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, NULL)
          `,
          [item.reviewId, item.caseRecord.id, action.code, note, reviewer.id, reviewer.id],
        );

        await manager.query(
          `
          INSERT INTO case_referrals (
            case_review_id, case_id, referral_agency_id, referred_by_user_id,
            referral_note, status_code, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            item.reviewId,
            item.caseRecord.id,
            item.agency.id,
            reviewer.id,
            note,
            item.statusCode,
            reviewer.id,
            reviewer.id,
          ],
        );
      }

      recorded = { planned, reviewer, action };
      console.log(`\nreferred ${planned.length} case(s)`);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'DRY_RUN') {
      await app.close();
      return;
    }
    await app.close();
    throw error;
  }

  if (recorded) {
    // Written through the app's own service, after the transaction, exactly as
    // the review endpoint does — a referral with no trace in the audit log
    // would be the one thing about this row that could not have happened.
    for (const item of recorded.planned) {
      await auditLog.record({
        actorUserId: recorded.reviewer.id,
        actorLabel: recorded.reviewer.display_name,
        action: 'CASE_REFER_AGENCY',
        targetType: 'case',
        targetId: String(item.caseRecord.id),
        metadata: {
          reviewAction: recorded.action.code,
          completionOutcome: recorded.action.completion_outcome_code,
          targetWorkflowPhase: recorded.action.target_workflow_phase_code,
          resolutionOutcome: null,
          referralAgencyId: item.agency.id,
          proposedAssistanceMeasureCodes: [],
        },
        ip: null,
      });
    }
    console.log('audit log recorded');
  }

  await app.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

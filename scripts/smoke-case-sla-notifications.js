const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run case SLA smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    const messages = error.errors.map((cause) => cause?.message || String(cause));
    return `AggregateError: ${messages.join(' | ')}`;
  }
  return error?.message || String(error);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const service = app.get(CaseService);
  const dataSource = app.get(DataSource);
  const runId = `AUTOMATED_TEST_CASE_SLA_${Date.now()}`;
  const now = new Date('2000-01-10T00:00:00.000Z');
  const caseIds = [];

  try {
    const schoolRows = await dataSource.query(
      `SELECT
         school.id,
         school.name,
         enrollment.student_uuid,
         CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM schools school
       INNER JOIN student_term enrollment ON enrollment."SchoolID_Onec" = school.id
       WHERE enrollment.person_uuid IS NOT NULL
       ORDER BY school.id, enrollment.student_uuid
       LIMIT 1`,
    );
    assert(schoolRows.length === 1, 'need at least one school');
    const school = schoolRows[0];

    const insertCase = async (suffix, createdAt, slaDueAt, riskTier) => {
      const rows = await dataSource.query(
        `
          INSERT INTO cases (
            student_uuid,
            student_name,
            school_id,
            student_school,
            reason_flagged,
            status,
            risk_tier,
            sla_due_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8)
          RETURNING id
        `,
        [
          school.student_uuid,
          school.student_name,
          school.id,
          school.name,
          'ขาดเรียนติดต่อกัน 5 วัน',
          riskTier,
          slaDueAt,
          createdAt,
        ],
      );
      caseIds.push(rows[0].id);
      return rows[0].id;
    };

    const warningCaseId = await insertCase(
      'warning',
      '2000-01-01T00:00:00.000Z',
      '2000-01-11T00:00:00.000Z',
      'MEDIUM',
    );
    const breachedCaseId = await insertCase(
      'breached',
      '2000-01-01T00:00:00.000Z',
      '2000-01-09T00:00:00.000Z',
      'HIGH',
    );
    const freshCaseId = await insertCase(
      'fresh',
      '2000-01-01T00:00:00.000Z',
      '2000-01-20T00:00:00.000Z',
      'LOW',
    );

    const result = await service.remindCaseSla(now);
    assert(result.warned === 1, 'exactly one warning case must be claimed');
    assert(result.breached === 1, 'exactly one breached case must be claimed');

    const markers = await dataSource.query(
      `
        SELECT id, sla_warning_notified_at, sla_breached_notified_at
        FROM cases
        WHERE id = ANY($1::int[])
      `,
      [caseIds],
    );
    const byId = new Map(markers.map((row) => [Number(row.id), row]));
    assert(byId.get(warningCaseId).sla_warning_notified_at, 'warning marker must be set');
    assert(!byId.get(warningCaseId).sla_breached_notified_at, 'warning case must not breach');
    assert(byId.get(breachedCaseId).sla_breached_notified_at, 'breach marker must be set');
    assert(!byId.get(freshCaseId).sla_warning_notified_at, 'fresh case must not warn');
    assert(!byId.get(freshCaseId).sla_breached_notified_at, 'fresh case must not breach');

    const notifications = await dataSource.query(
      `
        SELECT type_code, ref_id, student_person_uuid, case_id, student_name_masked, reason_text
        FROM notifications
        WHERE ref_entity = 'case'
          AND ref_id = ANY($1::text[])
      `,
      [caseIds.map(String)],
    );
    assert(
      notifications.some(
        (row) => row.type_code === 'CASE_SLA_WARNING' && row.ref_id === String(warningCaseId),
      ),
      'warning notification must be created',
    );
    assert(
      notifications.some(
        (row) => row.type_code === 'CASE_SLA_BREACHED' && row.ref_id === String(breachedCaseId),
      ),
      'breach notification must be created',
    );
    assert(
      !notifications.some((row) => row.ref_id === String(freshCaseId)),
      'fresh case must not create notifications',
    );
    assert(
      notifications.every(
        (row) =>
          row.student_person_uuid &&
          row.case_id &&
          row.student_name_masked &&
          row.reason_text === 'ขาดเรียนติดต่อกัน 5 วัน',
      ),
      'SLA notifications must persist relational student context and the case reason',
    );
    const auditRows = await dataSource.query(
      `
        SELECT action, target_id
        FROM audit_log
        WHERE target_type = 'case'
          AND target_id = ANY($1::text[])
      `,
      [caseIds.map(String)],
    );
    assert(
      auditRows.some(
        (row) => row.action === 'CASE_SLA_WARNING' && row.target_id === String(warningCaseId),
      ),
      'warning audit row must be created',
    );
    assert(
      auditRows.some(
        (row) => row.action === 'CASE_SLA_BREACHED' && row.target_id === String(breachedCaseId),
      ),
      'breach audit row must be created',
    );

    const secondPass = await service.remindCaseSla(now);
    assert(secondPass.warned === 0, 'second pass must not resend warnings');
    assert(secondPass.breached === 0, 'second pass must not resend breaches');

    console.log(
      `case SLA smoke passed (warning=${warningCaseId}, breached=${breachedCaseId}, fresh=${freshCaseId})`,
    );
  } finally {
    if (caseIds.length > 0) {
      await dataSource.query(`DELETE FROM notifications WHERE ref_entity = 'case' AND ref_id = ANY($1::text[])`, [
        caseIds.map(String),
      ]);
      await dataSource.query(`DELETE FROM cases WHERE id = ANY($1::int[])`, [caseIds]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

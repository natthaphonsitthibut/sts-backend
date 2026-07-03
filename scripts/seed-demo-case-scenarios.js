const { createHash } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run demo case scenario seed with NODE_ENV=production');
}

const CASE_ID = 1006;
const TASK_ID = 'seed-task-1006';
const LINK_ID = 'seed-link-1006';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);

  try {
    await dataSource.transaction(async (manager) => {
      const [caseRecord] = await manager.query(
        `SELECT id, school_id FROM cases WHERE id = $1 FOR UPDATE`,
        [CASE_ID],
      );
      if (!caseRecord) {
        throw new Error(`Demo case ${CASE_ID} is missing`);
      }

      await manager.query(
        `UPDATE cases
         SET status = 'PENDING_REVIEW',
             result_summary = 'ครูลงพื้นที่แล้ว รอผู้มีอำนาจตรวจผลและกำหนดแนวทางติดตาม'
         WHERE id = $1`,
        [CASE_ID],
      );
      await manager.query(
        `INSERT INTO tasks (
           id, case_id, status, max_delegation_depth, task_type, target_school_id
         ) VALUES ($1, $2, 'PENDING_REVIEW', 2, 'VISIT', $3)
         ON CONFLICT (id) DO UPDATE SET
           case_id = EXCLUDED.case_id,
           status = EXCLUDED.status,
           max_delegation_depth = EXCLUDED.max_delegation_depth,
           task_type = EXCLUDED.task_type,
           target_school_id = EXCLUDED.target_school_id`,
        [TASK_ID, CASE_ID, caseRecord.school_id],
      );
      await manager.query(
        `INSERT INTO task_links (
           id, task_id, token_hash, delegation_depth, assigned_to_name,
           assigned_to_phone, assigned_to_email, subject, status, expires_at
         ) VALUES ($1, $2, $3, 0, $4, $5, $6, $7, 'COMPLETED', NOW() + INTERVAL '30 days')
         ON CONFLICT (id) DO UPDATE SET
           task_id = EXCLUDED.task_id,
           assigned_to_name = EXCLUDED.assigned_to_name,
           assigned_to_phone = EXCLUDED.assigned_to_phone,
           assigned_to_email = EXCLUDED.assigned_to_email,
           subject = EXCLUDED.subject,
           status = EXCLUDED.status,
           expires_at = EXCLUDED.expires_at`,
        [
          LINK_ID,
          TASK_ID,
          createHash('sha256').update('demo-case-scenario-1006').digest('hex'),
          'ศิริพร พัฒนกิจ',
          '0812345678',
          'seed.teacher.review@example.test',
          'ติดตามนักเรียนเสี่ยงหลุดจากระบบและรายงานผล',
        ],
      );
      await manager.query(
        `INSERT INTO task_submissions (
           task_link_id, cause_category, cause_detail, recommendation,
           address_changed, submitted_at
         )
         SELECT $1, 'FAMILY', $2, $3, FALSE, NOW() - INTERVAL '1 day'
         WHERE NOT EXISTS (
           SELECT 1 FROM task_submissions WHERE task_link_id = $1
         )`,
        [
          LINK_ID,
          'ผู้ปกครองมีภาระงานต่างพื้นที่ นักเรียนขาดผู้ดูแลเรื่องการเดินทางบางวัน',
          'ประสานครูที่ปรึกษาและผู้ปกครอง วางตารางรับส่งและติดตามการมาเรียน 30 วัน',
        ],
      );
    });

    const statusCounts = await dataSource.query(
      `SELECT status, COUNT(*)::int AS count
       FROM cases
       GROUP BY status
       ORDER BY status`,
    );
    console.table(statusCounts);
    console.log('Demo case scenarios are complete and idempotent.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

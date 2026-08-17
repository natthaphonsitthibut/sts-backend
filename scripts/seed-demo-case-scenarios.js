const { createHash } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run demo case scenario seed with NODE_ENV=production');
}

const CASE_ID = 1006;

function deterministicUuid(value) {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
      const [creator] = await manager.query(
        `
          SELECT id
          FROM users
          WHERE username = 'orathai.b'
            AND role = 'ADMIN'
            AND status = 'ACTIVE'
            AND data_origin_code = 'DEMO'
          LIMIT 1
        `,
      );
      if (!creator?.id) {
        throw new Error('No active DEMO administrator is available for task attribution');
      }
      const [actor] = await manager.query(
        `
          SELECT
            teacher.id,
            TRIM(teacher.first_name || ' ' || teacher.last_name) AS display_name,
            teacher.email
          FROM teachers teacher
          JOIN school_teacher_memberships membership
            ON membership.teacher_id = teacher.id
           AND membership.school_id = $1::int
           AND membership.membership_status = 'ACTIVE'
           AND membership.deleted_at IS NULL
          WHERE teacher.teacher_status = 'ACTIVE'
            AND teacher.deleted_at IS NULL
            AND teacher.email IS NOT NULL
          ORDER BY teacher.id
          LIMIT 1
        `,
        [caseRecord.school_id],
      );
      if (!actor?.id) {
        throw new Error(`No active DEMO teacher is available for school ${caseRecord.school_id}`);
      }
      const [existingTask] = await manager.query(
        `
          SELECT id
          FROM tasks
          WHERE case_id = $1
            AND task_type = 'VISIT'
            AND deleted_at IS NULL
          ORDER BY created_at, id
          LIMIT 1
        `,
        [CASE_ID],
      );
      const taskId =
        existingTask?.id ?? deterministicUuid(`demo-case-scenario:task:${CASE_ID}`);
      const [existingLink] = await manager.query(
        `
          SELECT id
          FROM task_links
          WHERE task_id = $1
          ORDER BY created_at, id
          LIMIT 1
        `,
        [taskId],
      );
      const linkId =
        existingLink?.id ?? deterministicUuid(`demo-case-scenario:link:${CASE_ID}`);

      await manager.query(
        `UPDATE cases
         SET status = 'PENDING_REVIEW',
             result_summary = 'ครูลงพื้นที่แล้ว รอผู้มีอำนาจตรวจผลและกำหนดแนวทางติดตาม'
         WHERE id = $1`,
        [CASE_ID],
      );
      await manager.query(
        `INSERT INTO tasks (
           id, case_id, status, task_type, target_school_id, created_by, updated_by
         ) VALUES ($1, $2, 'PENDING_REVIEW', 'VISIT', $3, $4, $4)
         ON CONFLICT (id) DO UPDATE SET
           case_id = EXCLUDED.case_id,
           status = EXCLUDED.status,
           task_type = EXCLUDED.task_type,
           target_school_id = EXCLUDED.target_school_id,
           created_by = EXCLUDED.created_by,
           updated_by = EXCLUDED.updated_by`,
        [taskId, CASE_ID, caseRecord.school_id, creator.id],
      );
      await manager.query(
        `INSERT INTO task_links (
           id, task_id, token_hash, assigned_to_name,
           assigned_to_phone, assigned_to_email, subject, status, expires_at,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', NOW() + INTERVAL '30 days', $7, $7)
         ON CONFLICT (id) DO UPDATE SET
           task_id = EXCLUDED.task_id,
           assigned_to_name = EXCLUDED.assigned_to_name,
           assigned_to_phone = EXCLUDED.assigned_to_phone,
           assigned_to_email = EXCLUDED.assigned_to_email,
           subject = EXCLUDED.subject,
           status = EXCLUDED.status,
           expires_at = EXCLUDED.expires_at,
           created_by = EXCLUDED.created_by,
           updated_by = EXCLUDED.updated_by`,
        [
          linkId,
          taskId,
          createHash('sha256').update('demo-case-scenario-1006').digest('hex'),
          actor.display_name,
          null,
          actor.email,
          'ติดตามนักเรียนเสี่ยงหลุดจากระบบและรายงานผล',
          creator.id,
        ],
      );
      await manager.query(
        `INSERT INTO task_submissions (
           task_link_id, cause_category, cause_detail, recommendation,
           address_changed, submitted_at, created_by, updated_by
         )
         SELECT $1, 'FAMILY', $2, $3, FALSE, NOW() - INTERVAL '1 day', $4, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM task_submissions WHERE task_link_id = $1
         )`,
        [
          linkId,
          'ผู้ปกครองมีภาระงานต่างพื้นที่ นักเรียนขาดผู้ดูแลเรื่องการเดินทางบางวัน',
          'ประสานครูที่ปรึกษาและผู้ปกครอง วางตารางรับส่งและติดตามการมาเรียน 30 วัน',
          creator.id,
        ],
      );
      await manager.query(
        `
          UPDATE task_submissions
          SET created_by = $2,
              updated_by = $2
          WHERE task_link_id = $1
        `,
        [linkId, creator.id],
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

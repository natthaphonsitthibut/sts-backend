const { createHash, randomUUID } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { ImportsService } = require('../dist/imports/imports.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run quarantine retention smoke with NODE_ENV=production');
}

const SMOKE_KEY = 'quarantine-retention-smoke';
const SCHOOL_ID = 10010002;
const DAY_MS = 24 * 60 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function returningRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

async function cleanup(dataSource) {
  await dataSource.query(
    `DELETE FROM student_import_quarantine_rows q
     USING student_import_batches b
     WHERE q.batch_id = b.id AND b.scope_snapshot->>'smoke_key' = $1`,
    [SMOKE_KEY],
  );
  await dataSource.query(`DELETE FROM student_import_batches WHERE scope_snapshot->>'smoke_key' = $1`, [SMOKE_KEY]);
}

async function insertRow(dataSource, batchId, index, reasonCode, status, resolvedAt) {
  const [row] = returningRows(
    await dataSource.query(
      `INSERT INTO student_import_quarantine_rows (
         batch_id, school_id, source_row_number, row_fingerprint, reason_code,
         mapped_values, status, resolved_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, '{"PersonID_Onec":"9700000000099"}'::jsonb, $6, $7)
       RETURNING id::text`,
      [
        batchId,
        SCHOOL_ID,
        index,
        createHash('sha256').update(`${batchId}:${index}:${randomUUID()}`).digest('hex'),
        reasonCode,
        status,
        resolvedAt ? resolvedAt.toISOString() : null,
      ],
    ),
  );
  return row.id;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const importsService = app.get(ImportsService);
  const now = new Date();

  try {
    await cleanup(dataSource);
    const [batch] = returningRows(
      await dataSource.query(
        `INSERT INTO student_import_batches (
           target, source_sha256, scope_snapshot, status, total_rows, quarantined_rows, completed_at
         ) VALUES ('student_term', $1, $2::jsonb, 'PARTIAL', 4, 4, NOW())
         RETURNING id`,
        [createHash('sha256').update(randomUUID()).digest('hex'), JSON.stringify({ smoke_key: SMOKE_KEY })],
      ),
    );

    // Two are past the 180-day window (must be purged), two are retained.
    const expiredResolvedId = await insertRow(
      dataSource, batch.id, 2, 'GRADE_NOT_FOUND', 'RESOLVED', new Date(now.getTime() - 200 * DAY_MS),
    );
    const expiredRejectedId = await insertRow(
      dataSource, batch.id, 3, 'DUPLICATE_ROW_IN_FILE', 'REJECTED', new Date(now.getTime() - 181 * DAY_MS),
    );
    const recentResolvedId = await insertRow(
      dataSource, batch.id, 4, 'ROOM_NOT_FOUND', 'RESOLVED', new Date(now.getTime() - 179 * DAY_MS),
    );
    const oldPendingId = await insertRow(
      dataSource, batch.id, 5, 'IDENTIFIER_CONFLICT', 'PENDING', null,
    );

    const { deleted } = await importsService.cleanupExpiredQuarantine(now);
    assert(deleted === 2, `Expected 2 expired rows purged, got ${deleted}`);

    const survivors = await dataSource.query(
      `SELECT id::text FROM student_import_quarantine_rows WHERE batch_id = $1::uuid ORDER BY source_row_number`,
      [batch.id],
    );
    const survivorIds = survivors.map((row) => row.id);
    assert(!survivorIds.includes(expiredResolvedId), 'Expired RESOLVED row (200d) was not purged');
    assert(!survivorIds.includes(expiredRejectedId), 'Expired REJECTED row (181d) was not purged');
    assert(survivorIds.includes(recentResolvedId), 'Recent RESOLVED row (179d) must be retained');
    assert(survivorIds.includes(oldPendingId), 'PENDING row must never be purged by retention');

    // Idempotent: a second pass with the same clock deletes nothing more.
    const again = await importsService.cleanupExpiredQuarantine(now);
    assert(again.deleted === 0, `Second retention pass should delete 0, got ${again.deleted}`);

    console.log(
      JSON.stringify({
        status: 'quarantine_retention_smoke_ok',
        checked: [
          'RESOLVED older than 180d purged',
          'REJECTED older than 180d purged',
          'RESOLVED within 180d retained',
          'PENDING never purged',
          'retention pass is idempotent',
        ],
      }),
    );
  } finally {
    await cleanup(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});

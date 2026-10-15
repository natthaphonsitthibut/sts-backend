import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * National trends filter by date without a school/classroom prefix. Existing
 * school/classroom-first indexes cannot efficiently bound that read.
 * Build outside a transaction so attendance writes can continue during rollout.
 * No rows, columns, constraints or foreign keys change.
 */
export class IndexAttendanceTrendDate20261015180000 implements MigrationInterface {
  name = 'IndexAttendanceTrendDate20261015180000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A canceled concurrent build can leave an invalid index. Allow a safe retry.
    const invalid = (await queryRunner.query(`
      SELECT 1 FROM pg_index
      WHERE indexrelid = to_regclass('public.idx_attendance_sessions_subject_trend_date')
        AND NOT indisvalid
    `)) as unknown[];
    if (invalid.length > 0) {
      await queryRunner.query(`
        DROP INDEX CONCURRENTLY IF EXISTS public.idx_attendance_sessions_subject_trend_date
      `);
    }
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_sessions_subject_trend_date
      ON public.attendance_sessions (attendance_date)
      WHERE deleted_at IS NULL
        AND record_storage_mode = 'EXCEPTIONS'
        AND session_kind = 'SUBJECT'
        AND status IN ('SUBMITTED', 'REOPENED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS public.idx_attendance_sessions_subject_trend_date
    `);
  }
}

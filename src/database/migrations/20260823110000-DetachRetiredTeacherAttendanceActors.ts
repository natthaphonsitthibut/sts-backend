import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prepares the large attendance table for retired teacher-account removal.
 *
 * The following migration deletes TEACHER users. Its attendance actor foreign
 * keys use ON DELETE SET NULL, but asking one parent DELETE to rewrite more than
 * a million attendance rows can exhaust PostgreSQL storage through MVCC row
 * versions. This idempotent, non-transactional backfill performs that same
 * nulling in committed batches and vacuums reusable space before and after.
 *
 * `down()` cannot reconstruct retired user references and intentionally does
 * nothing. The historical recorder name and direct teacher identity remain in
 * `RecordedBy` and `recorded_by_teacher_id`.
 */
export class DetachRetiredTeacherAttendanceActors20260823110000 implements MigrationInterface {
  name = 'DetachRetiredTeacherAttendanceActors20260823110000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PARALLEL 0 avoids PostgreSQL allocating a large dynamic shared-memory
    // segment on small containers while producing the same table statistics.
    await queryRunner.query(`VACUUM (ANALYZE, PARALLEL 0) attendance`);

    let updatedRows: number;
    do {
      const result = (await queryRunner.query(`
        WITH candidates AS (
          SELECT record.ctid
          FROM attendance record
          WHERE record.created_by IN (SELECT id FROM users WHERE role = 'TEACHER')
             OR record.updated_by IN (SELECT id FROM users WHERE role = 'TEACHER')
          LIMIT 20000
        ), updated AS (
          UPDATE attendance record
          SET created_by = CASE
                WHEN record.created_by IN (SELECT id FROM users WHERE role = 'TEACHER') THEN NULL
                ELSE record.created_by
              END,
              updated_by = CASE
                WHEN record.updated_by IN (SELECT id FROM users WHERE role = 'TEACHER') THEN NULL
                ELSE record.updated_by
              END
          FROM candidates
          WHERE record.ctid = candidates.ctid
          RETURNING 1
        )
        SELECT COUNT(*)::int AS updated_rows FROM updated
      `)) as Array<{ updated_rows: number }>;
      updatedRows = Number(result[0]?.updated_rows ?? 0);
    } while (updatedRows > 0);

    await queryRunner.query(`VACUUM (ANALYZE, PARALLEL 0) attendance`);
  }

  public async down(): Promise<void> {}
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profile photo for a student, stored on the canonical person rather than the
 * per-term enrollment: a child keeps the same face across terms, schools and
 * any re-import of `student_term`.
 *
 * Only the storage key lives in the database — the object itself sits behind
 * the file-storage adapter (local disk or Supabase), served through
 * `GET /api/students/:id/photo` so the scope check runs before the bytes do,
 * exactly like `users.photo_storage_key`.
 */
export class AddStudentPersonPhoto20260804130000 implements MigrationInterface {
  name = 'AddStudentPersonPhoto20260804130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_person
        ADD COLUMN IF NOT EXISTS photo_storage_key TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_person DROP COLUMN IF EXISTS photo_storage_key
    `);
  }
}

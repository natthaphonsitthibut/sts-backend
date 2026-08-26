import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports the follow-up absence-category foreign key from the child side.
 * `ON UPDATE CASCADE / ON DELETE RESTRICT` makes PostgreSQL look up referencing
 * submissions on every catalog code change, and without this index that lookup
 * is a sequential scan of the whole submission table.
 */
export class AddFollowUpAbsenceCategoryIndex20260827320100 implements MigrationInterface {
  name = 'AddFollowUpAbsenceCategoryIndex20260827320100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_submissions_absence_reason_category
        ON task_submissions (absence_reason_category_code)
        WHERE absence_reason_category_code IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_task_submissions_absence_reason_category
    `);
  }
}

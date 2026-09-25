import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `task_links.first_used_at` recorded the first sign-in through a login link.
 * Login links were retired with the per-page permission collapse (2026-08-17),
 * which also removed the only writer, so the column has stayed empty and the
 * admin link detail kept returning a value that could never be set. Production
 * never holds a value; only the demo follow-up seed filled it on dev databases.
 */
export class DropTaskLinkFirstUsedAt20260926100000 implements MigrationInterface {
  name = 'DropTaskLinkFirstUsedAt20260926100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS first_used_at`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN IF NOT EXISTS first_used_at TIMESTAMPTZ`,
    );
  }
}

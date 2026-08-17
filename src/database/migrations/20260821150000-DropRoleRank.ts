import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `roles.rank` is deleted, not renamed.
 *
 * It was an authority ladder: you could not create a group at or above your own
 * number, nor manage an account whose role outranked you. Both rules were
 * replaced on 2026-08-17 by the one the owner asked for — a group may not reach
 * a page you do not hold — so the number decides nothing.
 *
 * The only thing left was ordering the list, and `is_system DESC, name ASC`
 * already produces the order that matters (ผู้ดูแลระบบ, ผู้อำนวยการ, ผู้บริหาร,
 * then a school's own groups by name). Keeping a column for that would mean
 * keeping a field on the create-group form asking an operator for a number whose
 * own help text described a rule the system no longer follows.
 *
 * `down()` restores the column and its index with the ranks the system roles
 * carried; groups created after this migration come back as 0.
 */
export class DropRoleRank20260821150000 implements MigrationInterface {
  name = 'DropRoleRank20260821150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_roles_school_rank_name`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_roles_school_name ON roles (school_id, name)
    `);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS rank`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE roles ADD COLUMN IF NOT EXISTS rank INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE roles SET rank = CASE name
        WHEN 'ADMIN' THEN 5
        WHEN 'DIRECTOR' THEN 4
        WHEN 'EXECUTIVE' THEN 3
        WHEN 'TEACHER' THEN 2
        WHEN 'STUDENT' THEN 1
        ELSE 0
      END
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_roles_school_name`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_roles_school_rank_name ON roles (school_id, rank DESC, name)
    `);
  }
}

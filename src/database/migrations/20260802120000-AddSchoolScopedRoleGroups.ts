import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps the existing global/system role catalog intact while allowing new
 * custom permission bundles to be owned by one school. Existing rows remain
 * NULL so current users and magic-login links continue resolving by role name.
 */
export class AddSchoolScopedRoleGroups20260802120000 implements MigrationInterface {
  name = 'AddSchoolScopedRoleGroups20260802120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN school_id INTEGER`);
    await queryRunner.query(`
      ALTER TABLE roles
      ADD CONSTRAINT fk_roles_school
      FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE roles
      ADD CONSTRAINT chk_roles_scoped_group_not_system
      CHECK (school_id IS NULL OR is_system = FALSE)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_roles_school_rank_name
      ON roles (school_id, rank DESC, name)
      WHERE school_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_roles_school_label_ci
      ON roles (school_id, LOWER(BTRIM(label)))
      WHERE school_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_roles_school_label_ci`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_roles_school_rank_name`);
    await queryRunner.query(
      `ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_roles_scoped_group_not_system`,
    );
    await queryRunner.query(`ALTER TABLE roles DROP CONSTRAINT IF EXISTS fk_roles_school`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS school_id`);
  }
}

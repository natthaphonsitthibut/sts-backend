import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The menu split has two defaults per realm:
 * - school: ผู้ดูแลระบบ, ผู้อำนวยการ
 * - council: ผู้ดูแลระบบ, ผู้บริหาร
 *
 * ADMIN and EXECUTIVE are the council's global defaults. School-owned role
 * groups must not receive the council-only EXECUTIVE group or the global
 * manage-schools permission.
 */
export class AlignSchoolCouncilRoleDefaults20260922120000 implements MigrationInterface {
  name = 'AlignSchoolCouncilRoleDefaults20260922120000';
  private readonly backupTable = 'school_council_role_defaults_backup_20260922';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${this.backupTable} (
        role_name TEXT PRIMARY KEY,
        original JSONB NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO ${this.backupTable} (role_name, original)
      SELECT school_role.name, to_jsonb(school_role)
      FROM roles school_role
      WHERE school_role.name ~ '^S[0-9]+_BASE_EXECUTIVE$'
        AND NOT EXISTS (
          SELECT 1 FROM users account WHERE account.role = school_role.name
        )
      ON CONFLICT (role_name) DO NOTHING
    `);
    await queryRunner.query(`
      DELETE FROM roles school_role
      WHERE school_role.name ~ '^S[0-9]+_BASE_EXECUTIVE$'
        AND NOT EXISTS (
          SELECT 1 FROM users account WHERE account.role = school_role.name
        )
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb) - 'manage-schools'
      WHERE school_id IS NOT NULL
        AND name ~ '^S[0-9]+_BASE_(ADMIN|DIRECTOR)$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${this.backupTable} (
        role_name TEXT PRIMARY KEY,
        original JSONB NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO roles
      SELECT (jsonb_populate_record(NULL::roles, backup.original)).*
      FROM ${this.backupTable} backup
      ON CONFLICT (name) DO NOTHING
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS ${this.backupTable}`);
  }
}

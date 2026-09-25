import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ผู้อำนวยการ also opens ส่งออกข้อมูล — export only, not import (owner,
 * 2026-09-25). Adds the one page to the director groups and to the accounts in
 * them, leaving anything else an operator has ticked alone.
 */
const DIRECTOR_GROUPS = `(name = 'DIRECTOR' OR name ~ '^S[0-9]+_BASE_DIRECTOR$')`;

export class GrantDirectorDataExport20260925100000 implements MigrationInterface {
  name = 'GrantDirectorDataExport20260925100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb) || '["export-data"]'::jsonb
      WHERE ${DIRECTOR_GROUPS}
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'export-data')
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = COALESCE(permissions, '[]'::jsonb) || '["export-data"]'::jsonb
      WHERE role IN (SELECT name FROM roles WHERE ${DIRECTOR_GROUPS})
        AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'export-data')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = default_permissions - 'export-data'
      WHERE ${DIRECTOR_GROUPS}
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = permissions - 'export-data'
      WHERE role IN (SELECT name FROM roles WHERE ${DIRECTOR_GROUPS})
    `);
  }
}

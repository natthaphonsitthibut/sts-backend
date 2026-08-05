import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantEditStudentsPermission20260701163000 implements MigrationInterface {
  name = 'GrantEditStudentsPermission20260701163000';

  // Direct edits to canonical student records are now gated separately from
  // read access. Grant the new permission only to governance roles by default;
  // teachers can still propose home-coordinate corrections through visit flow.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = default_permissions || '["edit-students"]'::jsonb
      WHERE name IN ('ADMIN','DIRECTOR')
        AND NOT (default_permissions ? 'edit-students')
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = permissions || '["edit-students"]'::jsonb
      WHERE role IN ('ADMIN','DIRECTOR')
        AND jsonb_typeof(permissions) = 'array'
        AND jsonb_array_length(permissions) > 0
        AND NOT (permissions ? 'edit-students')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles SET default_permissions = default_permissions - 'edit-students'
      WHERE name IN ('ADMIN','DIRECTOR')
    `);
    await queryRunner.query(`
      UPDATE users SET permissions = permissions - 'edit-students'
      WHERE role IN ('ADMIN','DIRECTOR') AND jsonb_typeof(permissions) = 'array'
    `);
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantAuditLogPermission20260630140000 implements MigrationInterface {
  name = 'GrantAuditLogPermission20260630140000';

  // The audit-log endpoints are now gated by a dedicated `audit-log` permission
  // (previously any authenticated user could read them). Grant it to the
  // governance roles so existing admins keep audit access (and the audit panel
  // they already use does not 403). Idempotent.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = default_permissions || '["audit-log"]'::jsonb
      WHERE name IN ('ADMIN','DIRECTOR')
        AND NOT (default_permissions ? 'audit-log')
    `);
    // Users with an explicit (overriding) permission set inherit nothing from the
    // role default, so grant them the permission directly.
    await queryRunner.query(`
      UPDATE users
      SET permissions = permissions || '["audit-log"]'::jsonb
      WHERE role IN ('ADMIN','DIRECTOR')
        AND jsonb_typeof(permissions) = 'array'
        AND jsonb_array_length(permissions) > 0
        AND NOT (permissions ? 'audit-log')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles SET default_permissions = default_permissions - 'audit-log'
      WHERE name IN ('ADMIN','DIRECTOR')
    `);
    await queryRunner.query(`
      UPDATE users SET permissions = permissions - 'audit-log'
      WHERE role IN ('ADMIN','DIRECTOR') AND jsonb_typeof(permissions) = 'array'
    `);
  }
}

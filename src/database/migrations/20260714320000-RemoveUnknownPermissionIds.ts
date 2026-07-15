import type { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen snapshot of the grantable permission catalog at migration creation.
// Historical migrations must not import the live catalog because later catalog
// changes would otherwise make this data repair behave differently over time.
const ALLOWED_PERMISSION_IDS = [
  'home',
  'dashboard',
  'students',
  'edit-students',
  'review-cases',
  'assign-follow-up-cases',
  'report-up-cases',
  'executive-report',
  'close-case',
  'student-self',
  'create',
  'import-data',
  'export-data',
  'attendance-dashboard',
  'attendance',
  'manage-attendance-calendar',
  'manage-timetable',
  'manage-users-list',
  'manage-users-hard-delete',
  'manage-student-accounts',
  'manage-role-groups',
  'login-links',
  'manage-schools',
  'manage-school-structure',
  'manage-teacher-access',
  'student-observations',
  'manage-student-observations',
  'import-school-roster',
  'settings',
  'audit-log',
  'field-monitor',
  '*',
  'ALL',
] as const;

export class RemoveUnknownPermissionIds20260714320000 implements MigrationInterface {
  name = 'RemoveUnknownPermissionIds20260714320000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = COALESCE((
          SELECT jsonb_agg(permission ORDER BY ordinal)
          FROM jsonb_array_elements_text(COALESCE(permissions, '[]'::jsonb))
            WITH ORDINALITY AS user_permissions(permission, ordinal)
          WHERE permission = ANY($1::text[])
        ), '[]'::jsonb)
        WHERE EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(permissions, '[]'::jsonb))
            AS user_permissions(permission)
          WHERE permission <> ALL($1::text[])
        )
      `,
      [ALLOWED_PERMISSION_IDS],
    );

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = COALESCE((
          SELECT jsonb_agg(permission ORDER BY ordinal)
          FROM jsonb_array_elements_text(COALESCE(default_permissions, '[]'::jsonb))
            WITH ORDINALITY AS role_permissions(permission, ordinal)
          WHERE permission = ANY($1::text[])
        ), '[]'::jsonb)
        WHERE EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(default_permissions, '[]'::jsonb))
            AS role_permissions(permission)
          WHERE permission <> ALL($1::text[])
        )
      `,
      [ALLOWED_PERMISSION_IDS],
    );
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    // Intentionally a no-op: removed permission ids are invalid and the exact
    // per-account historical grants cannot be reconstructed safely.
    void queryRunner;
    return Promise.resolve();
  }
}

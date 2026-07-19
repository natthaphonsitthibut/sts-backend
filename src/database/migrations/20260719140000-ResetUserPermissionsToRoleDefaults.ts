import type { MigrationInterface, QueryRunner } from 'typeorm';

const SYSTEM_ROLE_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  ADMIN: [
    'home',
    'dashboard',
    'students',
    'edit-students',
    'review-cases',
    'assign-follow-up-cases',
    'report-up-cases',
    'close-case',
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
  ],
  DIRECTOR: [
    'home',
    'dashboard',
    'students',
    'edit-students',
    'review-cases',
    'assign-follow-up-cases',
    'report-up-cases',
    'close-case',
    'create',
    'attendance',
    'attendance-dashboard',
    'manage-attendance-calendar',
    'manage-timetable',
    'manage-users-list',
    'login-links',
    'manage-schools',
    'manage-school-structure',
    'manage-teacher-access',
    'manage-student-observations',
    'import-school-roster',
    'settings',
    'export-data',
    'audit-log',
    'field-monitor',
  ],
  EXECUTIVE: ['home'],
  TEACHER: ['home', 'students', 'attendance', 'student-observations'],
  STUDENT: ['student-self'],
};

/** One-time data repair: reset every account to its role's current default permission list. */
export class ResetUserPermissionsToRoleDefaults20260719140000 implements MigrationInterface {
  name = 'ResetUserPermissionsToRoleDefaults20260719140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roleNames = Object.keys(SYSTEM_ROLE_DEFAULTS);
    const existingRoles = (await queryRunner.query(
      `SELECT name FROM roles WHERE name = ANY($1::varchar[])`,
      [roleNames],
    )) as Array<{ name: string }>;
    const existingRoleNames = new Set(existingRoles.map((role) => role.name));
    const missingRoleNames = roleNames.filter((roleName) => !existingRoleNames.has(roleName));
    if (missingRoleNames.length > 0) {
      throw new Error(
        `Cannot reset permission defaults; missing roles: ${missingRoleNames.join(', ')}`,
      );
    }

    const orphanUsers = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM users user_record
      LEFT JOIN roles role_record ON role_record.name = user_record.role
      WHERE role_record.name IS NULL
    `)) as Array<{ count: number }>;
    if (Number(orphanUsers[0]?.count ?? 0) > 0) {
      throw new Error('Cannot reset permission defaults while users reference an unknown role');
    }

    await queryRunner.query(`
      CREATE TABLE permission_default_reset_backups (
        id BIGSERIAL PRIMARY KEY,
        role_name VARCHAR(64),
        user_id INTEGER,
        original_permissions JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_permission_default_reset_backup_role
          FOREIGN KEY (role_name) REFERENCES roles(name)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_permission_default_reset_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_permission_default_reset_backup_owner
          CHECK ((role_name IS NULL) <> (user_id IS NULL)),
        CONSTRAINT chk_permission_default_reset_backup_json
          CHECK (jsonb_typeof(original_permissions) = 'array'),
        CONSTRAINT uq_permission_default_reset_backup_role UNIQUE (role_name),
        CONSTRAINT uq_permission_default_reset_backup_user UNIQUE (user_id)
      )
    `);
    await queryRunner.query(
      `
        INSERT INTO permission_default_reset_backups (role_name, original_permissions)
        SELECT name, default_permissions
        FROM roles
        WHERE name = ANY($1::varchar[])
      `,
      [roleNames],
    );
    await queryRunner.query(`
      INSERT INTO permission_default_reset_backups (user_id, original_permissions)
      SELECT id, COALESCE(permissions, '[]'::jsonb)
      FROM users
    `);

    for (const [roleName, permissions] of Object.entries(SYSTEM_ROLE_DEFAULTS)) {
      await queryRunner.query(`UPDATE roles SET default_permissions = $2::jsonb WHERE name = $1`, [
        roleName,
        JSON.stringify(permissions),
      ]);
    }
    await queryRunner.query(`
      UPDATE users user_record
      SET permissions = role_record.default_permissions
      FROM roles role_record
      WHERE role_record.name = user_record.role
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles role_record
      SET default_permissions = backup.original_permissions
      FROM permission_default_reset_backups backup
      WHERE backup.role_name = role_record.name;

      UPDATE users user_record
      SET permissions = backup.original_permissions
      FROM permission_default_reset_backups backup
      WHERE backup.user_id = user_record.id;

      DROP TABLE permission_default_reset_backups;
    `);
  }
}

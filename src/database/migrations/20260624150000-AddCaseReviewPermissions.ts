import type { MigrationInterface, QueryRunner } from 'typeorm';

type RolePermissions = {
  name: string;
  permissions: string[];
};

const CASE_PERMISSION_ROLES: RolePermissions[] = [
  {
    name: 'ADMIN',
    permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'manage-role-groups',
      'login-links',
      'settings',
      'import-data',
    ],
  },
  {
    name: 'ADMIN_PROVINCE',
    permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'ADMIN_DISTRICT',
    permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'ADMIN_SUBDISTRICT',
    permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'ADMIN_SCHOOL',
    permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'DIRECTOR',
    permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
      'settings',
    ],
  },
  {
    name: 'EXECUTIVE',
    permissions: ['home', 'dashboard', 'students', 'review-cases', 'attendance-dashboard'],
  },
];

const PREVIOUS_ROLE_PERMISSIONS: RolePermissions[] = [
  {
    name: 'ADMIN',
    permissions: [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'manage-role-groups',
      'login-links',
      'settings',
      'import-data',
    ],
  },
  {
    name: 'ADMIN_PROVINCE',
    permissions: [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'ADMIN_DISTRICT',
    permissions: [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'ADMIN_SUBDISTRICT',
    permissions: [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'ADMIN_SCHOOL',
    permissions: [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
  },
  {
    name: 'DIRECTOR',
    permissions: [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
      'settings',
    ],
  },
  {
    name: 'EXECUTIVE',
    permissions: ['home', 'dashboard', 'students', 'attendance-dashboard'],
  },
];

export class AddCaseReviewPermissions20260624150000 implements MigrationInterface {
  name = 'AddCaseReviewPermissions20260624150000';

  private async applyRolePermissions(
    queryRunner: QueryRunner,
    rolePermissions: RolePermissions[],
  ): Promise<void> {
    for (const role of rolePermissions) {
      await queryRunner.query(
        `
        UPDATE roles
        SET default_permissions = $2::jsonb
        WHERE name = $1
          AND is_system = TRUE
      `,
        [role.name, JSON.stringify(role.permissions)],
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.applyRolePermissions(queryRunner, CASE_PERMISSION_ROLES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.applyRolePermissions(queryRunner, PREVIOUS_ROLE_PERMISSIONS);
  }
}

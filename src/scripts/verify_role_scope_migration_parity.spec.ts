import {
  compareRoleScopeParity,
  type RoleScopeParityRow,
} from './verify_role_scope_migration_parity';

function buildRow(overrides: Partial<RoleScopeParityRow> = {}): RoleScopeParityRow {
  return {
    user_id: 77,
    old_role: 'ADMIN_SCHOOL',
    old_permissions: [],
    old_data_scope: {},
    current_role: 'ADMIN',
    current_permissions: ['home', 'students'],
    current_data_scope: { global: true },
    old_role_defaults: ['home', 'students'],
    current_role_defaults: ['home', 'dashboard'],
    ...overrides,
  };
}

describe('role/scope migration parity', () => {
  it('accepts a legacy admin mapped to ADMIN with preserved effective access', () => {
    expect(compareRoleScopeParity(buildRow())).toBeNull();
  });

  it('measures against role defaults once the reset migration has run', () => {
    const applied = new Set(['ResetUserPermissionsToRoleDefaults20260719140000']);
    // Reset to defaults, then narrowed by a role group: nothing was gained.
    expect(
      compareRoleScopeParity(
        buildRow({
          current_permissions: ['home'],
          current_role_defaults: ['home', 'dashboard', 'students'],
        }),
        { appliedMigrations: applied },
      ),
    ).toBeNull();

    // Holding a page the role never grants is still a finding.
    expect(
      compareRoleScopeParity(
        buildRow({
          current_permissions: ['home', 'settings'],
          current_role_defaults: ['home', 'dashboard'],
        }),
        { appliedMigrations: applied },
      ),
    ).toEqual({ userId: 77, issues: ['permissions beyond role defaults=settings'] });

    // Without the reset migration the pre-migration snapshot is still the baseline.
    expect(
      compareRoleScopeParity(
        buildRow({
          current_permissions: ['home'],
          current_role_defaults: ['home', 'dashboard', 'students'],
        }),
      ),
    ).toEqual({ userId: 77, issues: ['permissions removed=students'] });
  });

  it('accepts the migration own-only normalization for students', () => {
    expect(
      compareRoleScopeParity(
        buildRow({
          old_role: 'STUDENT',
          old_permissions: [],
          old_data_scope: { global: true },
          current_role: 'STUDENT',
          current_permissions: [],
          current_data_scope: { own_only: true },
          old_role_defaults: ['home', 'student-self'],
          current_role_defaults: ['home', 'student-self'],
        }),
      ),
    ).toBeNull();
  });

  it('reports permission expansion without exposing user identity fields', () => {
    expect(
      compareRoleScopeParity(
        buildRow({ current_permissions: ['home', 'students', 'manage-users-list'] }),
      ),
    ).toEqual({
      userId: 77,
      issues: ['permissions added=manage-users-list'],
    });
  });

  it('accounts for the later approved audit-log permission migration', () => {
    expect(
      compareRoleScopeParity(buildRow({ current_permissions: ['home', 'students', 'audit-log'] }), {
        appliedMigrations: new Set(['GrantAuditLogPermission20260630140000']),
      }),
    ).toBeNull();
  });

  it('reports missing users and changed scope keys', () => {
    expect(
      compareRoleScopeParity(
        buildRow({ current_role: null, current_data_scope: { school_ids: [10010002] } }),
      ),
    ).toEqual({
      userId: 77,
      issues: ['current user missing', 'scope mismatch keys=global,school_ids'],
    });
  });
});

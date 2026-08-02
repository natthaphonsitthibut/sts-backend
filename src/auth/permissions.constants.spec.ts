import {
  hasPermission,
  PERMISSION_CATALOG,
  SYSTEM_ROLE_DEFINITIONS,
} from './permissions.constants';

describe('hasPermission', () => {
  it.each(['*', 'ALL'])('denies raw access to restricted executives with %s', (wildcard) => {
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'students')).toBe(false);
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'manage-student-observations')).toBe(false);
  });

  it('allows restricted executives to use home when granted', () => {
    expect(hasPermission(['EXECUTIVE'], ['home'], 'home')).toBe(true);
    expect(hasPermission(['EXECUTIVE'], ['*'], 'home')).toBe(true);
  });

  it.each(['export-data', 'students'])(
    'denies retired or raw permission %s to restricted executives',
    (permission) => {
      expect(hasPermission(['EXECUTIVE'], [permission], permission)).toBe(false);
      expect(hasPermission(['EXECUTIVE'], ['*'], permission)).toBe(false);
    },
  );

  it('does not restrict an executive who also has a privileged operational role', () => {
    expect(hasPermission(['EXECUTIVE', 'ADMIN'], ['*'], 'students')).toBe(true);
    expect(hasPermission(['EXECUTIVE', 'DIRECTOR'], ['students'], 'students')).toBe(true);
  });

  it('gives ADMIN every grantable permission', () => {
    const admin = SYSTEM_ROLE_DEFINITIONS.find((role) => role.name === 'ADMIN');
    const expected = PERMISSION_CATALOG.map((permission) => permission.id);

    expect(admin?.default_permissions).toEqual(expected);
  });

  it('keeps student self-service internal and retires the STUDENT role', () => {
    expect(PERMISSION_CATALOG.map((permission) => permission.id)).not.toContain('student-self');
    expect(SYSTEM_ROLE_DEFINITIONS.map((role) => role.name)).not.toContain('STUDENT');
  });

  it('keeps every system role baseline explicit, unique, and inside the catalog', () => {
    const validPermissionIds = new Set(PERMISSION_CATALOG.map((permission) => permission.id));

    for (const role of SYSTEM_ROLE_DEFINITIONS) {
      expect(role.default_permissions.length).toBeGreaterThan(0);
      expect(new Set(role.default_permissions).size).toBe(role.default_permissions.length);
      expect(role.default_permissions).not.toContain('*');
      expect(role.default_permissions).not.toContain('ALL');
      expect(
        role.default_permissions.every((permissionId) => validPermissionIds.has(permissionId)),
      ).toBe(true);
    }
  });
});

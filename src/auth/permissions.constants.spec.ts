import {
  hasPermission,
  isRestrictedExecutive,
  PERMISSION_CATALOG,
  SYSTEM_ROLE_DEFINITIONS,
} from './permissions.constants';

describe('hasPermission', () => {
  it('grants exactly the pages the menu group carries, whatever the role is', () => {
    // ผู้บริหาร is not clamped to หน้าหลัก any more: the group's ticks decide.
    // Its own rule — never the raw text of a student record — is enforced by
    // isRestrictedExecutive where that text is read, not by hiding pages here.
    expect(hasPermission(['EXECUTIVE'], ['home', 'timetable'], 'timetable')).toBe(true);
    expect(hasPermission(['EXECUTIVE'], ['home', 'timetable'], 'home')).toBe(true);
    expect(hasPermission(['EXECUTIVE'], ['home', 'timetable'], 'students')).toBe(false);
    expect(hasPermission(['EXECUTIVE'], ['home', 'timetable'], 'export-data')).toBe(false);
  });

  it.each(['*', 'ALL'])('treats %s in storage as every page', (wildcard) => {
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'home')).toBe(true);
    expect(hasPermission(['DIRECTOR'], [wildcard], 'students')).toBe(true);
  });

  it('refuses a page nobody granted, for every role', () => {
    expect(hasPermission(['ADMIN'], ['home'], 'settings')).toBe(false);
    expect(hasPermission(['DIRECTOR'], [], 'students')).toBe(false);
    expect(hasPermission([], ['home'], 'home')).toBe(true);
  });

  it('keeps ผู้บริหาร out of raw student data regardless of pages', () => {
    // The page check above says nothing about raw text; this is the guard the
    // services call, and it must stay true even when the group grants a page.
    expect(isRestrictedExecutive({ roles: ['EXECUTIVE'] })).toBe(true);
    expect(isRestrictedExecutive({ roles: ['EXECUTIVE', 'ADMIN'] })).toBe(false);
    expect(isRestrictedExecutive({ roles: ['EXECUTIVE', 'DIRECTOR'] })).toBe(false);
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
      // A role you can assign has to grant something; a role that only marks an
      // identity (teachers, who reach the system through their link) must grant
      // nothing, so it can never become a way in.
      expect(role.default_permissions.length > 0).toBe(role.is_assignable);
      expect(new Set(role.default_permissions).size).toBe(role.default_permissions.length);
      expect(role.default_permissions).not.toContain('*');
      expect(role.default_permissions).not.toContain('ALL');
      expect(
        role.default_permissions.every((permissionId) => validPermissionIds.has(permissionId)),
      ).toBe(true);
    }
  });
});

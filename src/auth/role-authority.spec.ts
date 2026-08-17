import {
  canManageRole,
  roleReachesFurtherThanActor,
  type RoleAuthorityDefinition,
} from './role-authority';

const ROLE_MAP = new Map<string, RoleAuthorityDefinition>([
  ['ADMIN', { default_permissions: ['home', 'students', 'settings', 'manage-role-groups'] }],
  ['DIRECTOR', { default_permissions: ['home', 'students', 'settings'] }],
  ['EXECUTIVE', { default_permissions: ['home'] }],
  ['S1_BASE_DIRECTOR', { default_permissions: ['home', 'students', 'settings'] }],
]);

describe('canManageRole', () => {
  it('lets an actor manage a group that reaches no further than its own', () => {
    expect(canManageRole('ADMIN', 'DIRECTOR', ROLE_MAP)).toBe(true);
    expect(canManageRole('DIRECTOR', 'EXECUTIVE', ROLE_MAP)).toBe(true);
    expect(canManageRole('DIRECTOR', 'S1_BASE_DIRECTOR', ROLE_MAP)).toBe(true);
  });

  it('refuses a group that reaches a page the actor does not hold', () => {
    // DIRECTOR has no manage-role-groups, so it cannot touch an ADMIN account.
    expect(canManageRole('DIRECTOR', 'ADMIN', ROLE_MAP)).toBe(false);
    expect(canManageRole('EXECUTIVE', 'DIRECTOR', ROLE_MAP)).toBe(false);
  });

  it('allows peers only for ADMIN', () => {
    expect(canManageRole('ADMIN', 'ADMIN', ROLE_MAP)).toBe(true);
    expect(canManageRole('DIRECTOR', 'DIRECTOR', ROLE_MAP)).toBe(false);
    expect(canManageRole('S1_BASE_DIRECTOR', 'S1_BASE_DIRECTOR', ROLE_MAP)).toBe(false);
  });

  it('fails closed when a role is missing from the catalogue', () => {
    // `listRoleRows` only returns is_assignable rows, so a retired role such as
    // ADMIN_SCHOOL is absent. Reading "no pages" as "nothing to clear" would let
    // anyone manage those accounts, because [].every() is true.
    expect(canManageRole('EXECUTIVE', 'ADMIN_SCHOOL', ROLE_MAP)).toBe(false);
    expect(canManageRole('UNKNOWN_GROUP', 'DIRECTOR', ROLE_MAP)).toBe(false);
    expect(canManageRole(null, 'DIRECTOR', ROLE_MAP)).toBe(false);
    expect(canManageRole('ADMIN', 'DIRECTOR', new Map())).toBe(false);
  });

  it('treats a target with no role at all as manageable', () => {
    expect(canManageRole('DIRECTOR', null, ROLE_MAP)).toBe(true);
    expect(canManageRole('DIRECTOR', '', ROLE_MAP)).toBe(true);
  });
});

describe('roleReachesFurtherThanActor', () => {
  it('answers the same question for the write path', () => {
    expect(roleReachesFurtherThanActor('ADMIN', 'DIRECTOR', ROLE_MAP)).toBe(false);
    expect(roleReachesFurtherThanActor('DIRECTOR', 'ADMIN', ROLE_MAP)).toBe(true);
  });

  it('refuses a role the catalogue does not offer', () => {
    expect(roleReachesFurtherThanActor('ADMIN', 'ADMIN_SCHOOL', ROLE_MAP)).toBe(true);
    expect(roleReachesFurtherThanActor('ADMIN', null, ROLE_MAP)).toBe(true);
  });
});

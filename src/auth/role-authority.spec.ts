import {
  canGrantPages,
  grantablePages,
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

describe('canGrantPages', () => {
  it('limits an actor without an account-admin page to the pages it holds', () => {
    expect(canGrantPages(['home', 'students'], ['home'])).toBe(true);
    expect(canGrantPages(['home', 'students'], ['teachers'])).toBe(false);
  });

  it('lets an account admin hand out any page of its realm, held or not', () => {
    // A school admin does not open รายชื่อนักเรียน but must create its ผอ.
    const schoolAdmin = ['home', 'manage-users-list', 'manage-role-groups'];
    expect(canGrantPages(schoolAdmin, ['students', 'teachers', 'import-data'])).toBe(true);
    expect(canGrantPages(['manage-role-groups'], ['attendance'])).toBe(true);
  });

  it('never lets an account admin hand out a national page it does not hold', () => {
    const schoolAdmin = ['home', 'manage-users-list', 'manage-role-groups'];
    expect(canGrantPages(schoolAdmin, ['settings'])).toBe(false);
    expect(canGrantPages(schoolAdmin, ['master-data'])).toBe(false);
    expect(canGrantPages(schoolAdmin, ['manage-schools'])).toBe(false);
    expect(canGrantPages([...schoolAdmin, 'settings'], ['settings'])).toBe(true);
  });

  it('keeps council pages that are not national out of reach unless held', () => {
    // แชตบอท is the council's; a school admin cannot hand it out, even to itself.
    const schoolAdmin = ['home', 'manage-users-list', 'manage-role-groups'];
    expect(canGrantPages(schoolAdmin, ['nl_query:use'])).toBe(false);
    expect(grantablePages(schoolAdmin).has('nl_query:use')).toBe(false);
    expect(canGrantPages([...schoolAdmin, 'nl_query:use'], ['nl_query:use'])).toBe(true);
  });

  it('keeps the wildcard', () => {
    expect(canGrantPages(['*'], ['settings'])).toBe(true);
  });

  it('carries into the role ladder', () => {
    const map = new Map<string, RoleAuthorityDefinition>([
      ['S1_BASE_ADMIN', { default_permissions: ['home', 'manage-users-list'] }],
      ['S1_BASE_DIRECTOR', { default_permissions: ['home', 'students', 'teachers'] }],
      ['ADMIN', { default_permissions: ['home', 'settings'] }],
    ]);
    expect(canManageRole('S1_BASE_ADMIN', 'S1_BASE_DIRECTOR', map)).toBe(true);
    expect(canManageRole('S1_BASE_ADMIN', 'ADMIN', map)).toBe(false);
    expect(roleReachesFurtherThanActor('S1_BASE_ADMIN', 'S1_BASE_DIRECTOR', map)).toBe(false);
  });
});

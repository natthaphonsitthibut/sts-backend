import { ForbiddenException } from '@nestjs/common';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import type { ActorContext, RoleDefinition } from './users.types';

const definitions: RoleDefinition[] = [
  {
    id: 1,
    name: 'ADMIN',
    label: 'ผู้ดูแลระบบ',
    rank: 5,
    default_permissions: ['home', 'manage-users-list'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    id: 2,
    name: 'DIRECTOR',
    label: 'ผู้อำนวยการ',
    rank: 4,
    default_permissions: ['home', 'manage-users-list'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    id: 3,
    name: 'EXECUTIVE',
    label: 'ผู้บริหาร',
    rank: 3,
    default_permissions: ['home', 'dashboard'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    id: 4,
    name: 'TEACHER',
    label: 'ครู',
    rank: 2,
    default_permissions: ['home', 'students'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    id: 5,
    name: 'STUDENT',
    label: 'นักเรียน',
    rank: 1,
    default_permissions: ['home', 'student-self'],
    scope_mode: 'flexible',
    scope_policy: 'OWN_ONLY',
    is_assignable: true,
    is_system: true,
  },
];

const roleMap = new Map(definitions.map((role) => [role.name, role]));
const globalAdmin: ActorContext = {
  id: 1,
  username: 'global-admin',
  roles: ['ADMIN'],
  permissions: ['home', 'manage-users-list'],
  data_scope: { global: true },
};

const scopedAdmin: ActorContext = {
  ...globalAdmin,
  id: 2,
  username: 'scoped-admin',
  data_scope: {
    provinces: ['ชลบุรี'],
    districts: ['เมืองชลบุรี'],
    sub_districts: ['บ้านสวน'],
    school_ids: [10010002],
  },
};

const scopedTeacher = {
  id: 100,
  role: 'TEACHER',
  roles: ['TEACHER'],
  data_scope: {
    provinces: ['ชลบุรี'],
    districts: ['เมืองชลบุรี'],
    sub_districts: ['บ้านสวน'],
    school_ids: [10010002],
  },
};

describe('UsersPolicyService functional roles and data scope', () => {
  const service = new UsersPolicyService({} as UsersRepository);

  it('allows one ADMIN role to be assigned with a school scope', async () => {
    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: { school_ids: [10010002] },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects assigning global scope from a school-scoped admin', async () => {
    await expect(
      service.assertAssignablePayload(
        { ...globalAdmin, data_scope: { school_ids: [10010002] } },
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: { global: true },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows empty scope (nationwide) from a global admin', async () => {
    // Empty flexible scope = nationwide; the UI confirms this explicitly.
    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: {},
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects empty (nationwide) scope from a school-scoped admin', async () => {
    // A scoped admin still cannot mint a broader-than-self (nationwide) account.
    await expect(
      service.assertAssignablePayload(
        { ...globalAdmin, data_scope: { school_ids: [10010002] } },
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: {},
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires own-only scope for STUDENT', async () => {
    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['home', 'student-self'],
          data_scope: { school_ids: [10010002] },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['home', 'student-self'],
          data_scope: { school_ids: [10010002], own_only: true },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['same full school scope', scopedAdmin.data_scope, scopedTeacher.data_scope, true],
    [
      'target narrower grade scope inside the same school',
      scopedAdmin.data_scope,
      { ...scopedTeacher.data_scope, grade_levels: [6] },
      true,
    ],
    [
      'target narrower room scope inside the same school',
      { ...scopedAdmin.data_scope, grade_levels: [6], room_ids: [1] },
      { ...scopedTeacher.data_scope, grade_levels: [6], room_ids: [1] },
      true,
    ],
    [
      'target outside actor province',
      scopedAdmin.data_scope,
      { ...scopedTeacher.data_scope, provinces: ['ระยอง'] },
      false,
    ],
    [
      'target outside actor district',
      scopedAdmin.data_scope,
      { ...scopedTeacher.data_scope, districts: ['ศรีราชา'] },
      false,
    ],
    [
      'target outside actor school',
      scopedAdmin.data_scope,
      { ...scopedTeacher.data_scope, school_ids: [10010003] },
      false,
    ],
    [
      'target outside actor grade',
      { ...scopedAdmin.data_scope, grade_levels: [6] },
      { ...scopedTeacher.data_scope, grade_levels: [5] },
      false,
    ],
    [
      'target outside actor room',
      { ...scopedAdmin.data_scope, grade_levels: [6], room_ids: [1] },
      { ...scopedTeacher.data_scope, grade_levels: [6], room_ids: [2] },
      false,
    ],
    ['target global scope', scopedAdmin.data_scope, { global: true }, false],
  ])('checks scope subset for %s', (_name, actorScope, targetScope, expected) => {
    expect(
      service.canManageUser(
        { ...scopedAdmin, data_scope: actorScope },
        { ...scopedTeacher, data_scope: targetScope },
        roleMap,
      ),
    ).toBe(expected);
  });

  it('denies managing higher or equal role unless the actor is ADMIN', () => {
    const director: ActorContext = {
      ...globalAdmin,
      id: 3,
      username: 'director',
      roles: ['DIRECTOR'],
      permissions: ['home', 'manage-users-list'],
    };

    expect(
      service.canManageUser(
        director,
        { ...scopedTeacher, role: 'ADMIN', roles: ['ADMIN'] },
        roleMap,
      ),
    ).toBe(false);
    expect(
      service.canManageUser(
        director,
        { ...scopedTeacher, role: 'DIRECTOR', roles: ['DIRECTOR'] },
        roleMap,
      ),
    ).toBe(false);
    expect(service.canManageUser(director, scopedTeacher, roleMap)).toBe(true);
  });

  it('always allows an actor to manage its own account without widening other users', () => {
    const student: ActorContext = {
      id: 7,
      username: 'student',
      roles: ['STUDENT'],
      permissions: ['home', 'student-self'],
      data_scope: { own_only: true },
    };

    expect(
      service.canManageUser(
        student,
        { id: 7, role: 'STUDENT', roles: ['STUDENT'], data_scope: { own_only: true } },
        roleMap,
      ),
    ).toBe(true);
    expect(
      service.canManageUser(
        student,
        { id: 8, role: 'STUDENT', roles: ['STUDENT'], data_scope: { own_only: true } },
        roleMap,
      ),
    ).toBe(false);
  });

  it('rejects assigning a wider scope than the actor but allows a narrower class scope', async () => {
    await expect(
      service.assertAssignablePayload(
        scopedAdmin,
        {
          role: 'TEACHER',
          roles: ['TEACHER'],
          permissions: ['home'],
          data_scope: { provinces: ['ชลบุรี'], districts: ['เมืองชลบุรี'] },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.assertAssignablePayload(
        scopedAdmin,
        {
          role: 'TEACHER',
          roles: ['TEACHER'],
          permissions: ['home'],
          data_scope: {
            provinces: ['ชลบุรี'],
            districts: ['เมืองชลบุรี'],
            sub_districts: ['บ้านสวน'],
            school_ids: [10010002],
            grade_levels: [6],
            room_ids: [1],
          },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).resolves.toBeUndefined();
  });
});

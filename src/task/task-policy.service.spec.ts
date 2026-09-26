import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

describe('TaskPolicyService data scope policy', () => {
  const service = new TaskPolicyService({} as TaskRepository);
  const schoolScope = {
    provinces: ['ชลบุรี'],
    districts: ['เมืองชลบุรี'],
    sub_districts: ['บ้านสวน'],
    school_ids: [10010002],
  };

  it('keeps an explicitly empty login permission snapshot empty', () => {
    expect(service.resolveEffectivePermissions('TEACHER', [], new Map())).toEqual([]);
  });

  it('does not restore removed grant authority from the actor role baseline', () => {
    expect(service.canGrantPermissions(['home'], ['attendance'], 'ADMIN', new Map())).toBe(false);
  });

  it.each([
    ['empty actor scope', {}, schoolScope, false],
    ['global actor scope', { global: true }, schoolScope, true],
    ['same scoped actor', schoolScope, schoolScope, true],
    ['outside scoped actor', schoolScope, { ...schoolScope, school_ids: [10010003] }, false],
  ])('checks scope subset for %s', (_name, actorScope, targetScope, expected) => {
    expect(service.isScopeSubsetOfActor(targetScope, actorScope)).toBe(expected);
  });

  it('allows review-cases actors to manage visit links in scope', () => {
    expect(
      service.canManageAdminLink(
        {
          id: 7,
          username: 'case-reviewer',
          roles: ['ADMIN'],
          permissions: ['dashboard'],
          data_scope: { school_ids: [10010002] },
        },
        {
          task_type: 'VISIT',
          target_school_id: 10010002,
        },
      ),
    ).toBe(true);
  });

  it('allows own-only review-cases actors to manage owned visit links', () => {
    expect(
      service.canManageAdminLink(
        {
          id: 9,
          username: 'own-case-reviewer',
          roles: ['ADMIN'],
          permissions: ['dashboard'],
          data_scope: { own_only: true },
        },
        {
          task_type: 'VISIT',
          target_school_id: 10010002,
          case_created_by: 9,
        },
      ),
    ).toBe(true);
  });

  it('rejects own-only review-cases actors for other visit links', () => {
    expect(
      service.canManageAdminLink(
        {
          id: 9,
          username: 'own-case-reviewer',
          roles: ['ADMIN'],
          permissions: ['dashboard'],
          data_scope: { own_only: true },
        },
        {
          task_type: 'VISIT',
          target_school_id: 10010002,
          case_created_by: 10,
        },
      ),
    ).toBe(false);
  });

  it('admits visit link management to the รายงานสถานะนักเรียน page', () => {
    expect(
      service.canManageAdminLink(
        {
          id: 8,
          username: 'dashboard-only',
          roles: ['ADMIN'],
          permissions: ['dashboard'],
          data_scope: { school_ids: [10010002] },
        },
        {
          task_type: 'VISIT',
          target_school_id: 10010002,
        },
      ),
    ).toBe(true);
  });

  it.each([
    ['in-scope actor', { school_ids: [10010002] }, 10010002, undefined, true],
    ['out-of-scope actor', { school_ids: [10010003] }, 10010002, undefined, false],
    ['own-only case creator', { own_only: true }, 10010002, 9, true],
    ['own-only non-creator', { own_only: true }, 10010002, 10, false],
  ])(
    'applies the visit rule to assistance links for an %s',
    (_name, dataScope, school, creator, expected) => {
      expect(
        service.canManageAdminLink(
          {
            id: 9,
            username: 'case-reviewer',
            roles: ['ADMIN'],
            permissions: ['dashboard'],
            data_scope: dataScope,
          },
          { task_type: 'ASSIST', target_school_id: school, case_created_by: creator },
        ),
      ).toBe(expected);
    },
  );

  it('rejects assistance links for actors without the dashboard page', () => {
    expect(
      service.canManageAdminLink(
        {
          id: 9,
          username: 'no-dashboard',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: { global: true },
        },
        { task_type: 'ASSIST', target_school_id: 10010002 },
      ),
    ).toBe(false);
  });

  it('still rejects retired link types', () => {
    expect(
      service.canManageAdminLink(
        {
          id: 9,
          username: 'national',
          roles: ['ADMIN'],
          permissions: ['dashboard'],
          data_scope: { global: true },
        },
        { task_type: 'LOGIN', target_school_id: 10010002 },
      ),
    ).toBe(false);
  });
});

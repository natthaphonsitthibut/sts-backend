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
          permissions: ['review-cases'],
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
          permissions: ['review-cases'],
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
          permissions: ['review-cases'],
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

  it('rejects visit link management without review-cases permission', () => {
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
    ).toBe(false);
  });
});

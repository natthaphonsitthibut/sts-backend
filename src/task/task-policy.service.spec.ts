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

  it.each([
    ['empty actor scope', {}, schoolScope, false],
    ['global actor scope', { global: true }, schoolScope, true],
    ['same scoped actor', schoolScope, schoolScope, true],
    ['outside scoped actor', schoolScope, { ...schoolScope, school_ids: [10010003] }, false],
  ])('checks scope subset for %s', (_name, actorScope, targetScope, expected) => {
    expect(service.isScopeSubsetOfActor(targetScope, actorScope)).toBe(expected);
  });
});

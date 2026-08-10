import { ConflictException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { AuthenticatedRequestUser } from '../auth';
import { TeachersService } from './teachers.service';
import type { TeachersRepository } from './teachers.repository';

const ACTOR: AuthenticatedRequestUser = {
  id: 1,
  username: 'admin',
  roles: ['ADMIN'],
  permissions: ['manage-teachers'],
  data_scope: { school_ids: [10] },
};

/** What node-postgres raises when a partial unique index rejects a write. */
function uniqueViolation(constraint: string): Error & { code: string; constraint: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

function createHarness() {
  const repository = {
    withTransaction: jest.fn(async (operation: (runner: QueryRunner) => Promise<unknown>) =>
      operation({} as QueryRunner),
    ),
    isSchoolInScope: jest.fn().mockResolvedValue(true),
    findTeacherByCitizenId: jest.fn().mockResolvedValue(null),
    findActiveMembership: jest.fn().mockResolvedValue(null),
    createTeacher: jest.fn(),
    reactivateTeacher: jest.fn(),
    createMembership: jest.fn().mockResolvedValue({ id: '5' }),
    findTeacherById: jest.fn(),
    updateTeacher: jest.fn(),
    deactivateTeacher: jest.fn(),
  };
  const auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
  const storage = { save: jest.fn(), delete: jest.fn(), resolve: jest.fn(), open: jest.fn() };
  const service = new TeachersService(
    repository as unknown as TeachersRepository,
    auditLog as never,
    storage as never,
  );
  return { service, repository };
}

describe('TeachersService duplicate identity messages', () => {
  it('names the email when the email index rejects a new teacher', async () => {
    const { service, repository } = createHarness();
    repository.createTeacher.mockRejectedValue(uniqueViolation('uq_teachers_email'));

    await expect(
      service.create(
        { schoolId: 10, firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@example.com' },
        ACTOR,
      ),
    ).rejects.toThrow(new ConflictException('อีเมลนี้ถูกใช้กับครูคนอื่นแล้ว'));
  });

  it('still names the national id when that index is the one that rejected', async () => {
    const { service, repository } = createHarness();
    repository.createTeacher.mockRejectedValue(uniqueViolation('uq_teachers_citizen_id'));

    await expect(
      service.create(
        { schoolId: 10, firstName: 'สมชาย', lastName: 'ใจดี', citizenId: '1234567890123' },
        ACTOR,
      ),
    ).rejects.toThrow(new ConflictException('เลขบัตรประชาชนนี้มีอยู่ในระบบแล้ว'));
  });

  it('names the email when an edit moves it onto another teacher', async () => {
    const { service, repository } = createHarness();
    repository.findTeacherById.mockResolvedValue({ id: '7', school_id: 10, membership_id: '5' });
    repository.updateTeacher.mockRejectedValue(uniqueViolation('uq_teachers_email'));

    await expect(service.update('7', { email: 'taken@example.com' }, ACTOR)).rejects.toThrow(
      new ConflictException('อีเมลนี้ถูกใช้กับครูคนอื่นแล้ว'),
    );
  });
});

describe('TeachersService canonical teacher lifecycle', () => {
  it('reactivates an inactive canonical teacher before attaching a new membership', async () => {
    const { service, repository } = createHarness();
    repository.findTeacherByCitizenId.mockResolvedValue({
      id: '7',
      teacher_status: 'INACTIVE',
    });
    repository.findTeacherById.mockResolvedValue({
      id: '7',
      school_id: 10,
      membership_id: '5',
      teacher_status: 'ACTIVE',
    });

    await service.create(
      { schoolId: 10, firstName: 'สมชาย', lastName: 'ใจดี', citizenId: '1234567890123' },
      ACTOR,
    );

    expect(repository.reactivateTeacher).toHaveBeenCalledWith('7', 1, expect.anything());
    expect(repository.createMembership).toHaveBeenCalledWith(
      { teacherId: '7', schoolId: 10, actorId: 1 },
      expect.anything(),
    );
    expect(repository.createTeacher).not.toHaveBeenCalled();
  });
});

describe('TeachersService deactivate', () => {
  it('deactivates a teacher membership and its active teaching coverage', async () => {
    const { service, repository } = createHarness();
    repository.findTeacherById.mockResolvedValue({
      id: '7',
      school_id: 10,
      membership_id: '5',
      membership_status: 'ACTIVE',
    });

    await expect(service.deactivate('7', {}, ACTOR)).resolves.toEqual({ success: true });

    expect(repository.deactivateTeacher).toHaveBeenCalledWith(
      { teacherId: '7', membershipId: '5', actorId: 1 },
      expect.anything(),
    );
  });
});

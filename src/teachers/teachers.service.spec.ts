import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    findActiveHomeroomTeacherInScope: jest.fn(),
    listActivePiiRevealGroups: jest.fn().mockResolvedValue([]),
    insertPiiAccessEvent: jest.fn().mockResolvedValue(undefined),
    updateTeacher: jest.fn(),
    lockHomeroomClassroomsForTeacher: jest.fn().mockResolvedValue(undefined),
    deactivateTeacher: jest.fn(),
  };
  const auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
  const storage = { save: jest.fn(), delete: jest.fn(), resolve: jest.fn(), open: jest.fn() };
  const service = new TeachersService(
    repository as unknown as TeachersRepository,
    auditLog as never,
    storage as never,
    {
      hashPepper: 'teachers-service-test-pepper',
      hashKeyVersion: 1,
      revealTtlSeconds: 900,
    },
  );
  return { service, repository, storage };
}

const PROFILE_ROW = {
  id: '7',
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  citizen_id: '1234567890123',
  phone: '0812345678',
  email: 'teacher@example.com',
  line_id: 'teacher-line',
  photo_storage_key: 'teachers/7/photo.webp',
  teacher_status: 'ACTIVE',
  membership_id: '5',
  school_id: 10,
  membership_status: 'ACTIVE',
  started_on: '2026-05-01',
  ended_on: null,
  updated_at: '2026-08-25T10:00:00.000Z',
} as const;

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

describe('TeachersService read-only profile access', () => {
  const CLASSROOM_LINK_ACTOR: AuthenticatedRequestUser = {
    ...ACTOR,
    permissions: ['manage-classroom-links'],
    data_scope: { school_ids: [10], grade_levels: [1], room_ids: [2] },
  };

  it('returns a scoped homeroom profile with a masked national id and no storage key', async () => {
    const { service, repository } = createHarness();
    repository.findActiveHomeroomTeacherInScope.mockResolvedValue(PROFILE_ROW);

    const result = await service.findProfile('7', CLASSROOM_LINK_ACTOR);

    expect(repository.findActiveHomeroomTeacherInScope).toHaveBeenCalledWith(
      '7',
      CLASSROOM_LINK_ACTOR.data_scope,
    );
    expect(result.data.id).toBe('7');
    expect(result.data.fullName).toBe('สมชาย ใจดี');
    expect(result.data.photoUrl).toMatch(/^\/api\/teacher-profiles\/7\/photo\?v=/);
    expect(result.data).toMatchObject({
      citizenId: '•••••••••••••',
      maskedFields: ['citizenId'],
    });
    expect(result.data).not.toHaveProperty('photo_storage_key');
  });

  it('does not let classroom-link-only viewers reveal the national id', async () => {
    const { service, repository } = createHarness();
    repository.findActiveHomeroomTeacherInScope.mockResolvedValue(PROFILE_ROW);

    await expect(
      service.revealNationalId(
        '7',
        CLASSROOM_LINK_ACTOR,
        { field_group: 'NATIONAL_ID', reason_code: 'VERIFY_DATA' },
        { requestId: null, ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.insertPiiAccessEvent).not.toHaveBeenCalled();
  });

  it('reveals to a scoped directory viewer and audits only a keyed reference', async () => {
    const { service, repository } = createHarness();
    const directoryActor: AuthenticatedRequestUser = {
      ...ACTOR,
      permissions: ['teachers'],
    };
    repository.findTeacherById.mockResolvedValue(PROFILE_ROW);

    await expect(
      service.revealNationalId(
        '7',
        directoryActor,
        {
          field_group: 'NATIONAL_ID',
          reason_code: 'VERIFY_DATA',
          reason_note: 'ตรวจความถูกต้องก่อนประสานงาน',
        },
        { requestId: 'req-1', ip: '127.0.0.1', userAgent: 'jest' },
      ),
    ).resolves.toEqual({
      field_group: 'NATIONAL_ID',
      values: { citizenId: '1234567890123' },
    });

    expect(repository.insertPiiAccessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: directoryActor.id,
        reasonCode: 'VERIFY_DATA',
        reasonNote: 'ตรวจความถูกต้องก่อนประสานงาน',
      }),
    );
    expect(JSON.stringify(repository.insertPiiAccessEvent.mock.calls)).not.toContain(
      '1234567890123',
    );
  });

  it('hides an out-of-scope guessed teacher id', async () => {
    const { service, repository } = createHarness();
    repository.findActiveHomeroomTeacherInScope.mockResolvedValue(null);

    await expect(service.findProfile('99', CLASSROOM_LINK_ACTOR)).rejects.toThrow(
      new NotFoundException('ไม่พบข้อมูลครู'),
    );
  });

  it('resolves a signed photo only after the same profile scope check', async () => {
    const { service, repository, storage } = createHarness();
    repository.findActiveHomeroomTeacherInScope.mockResolvedValue(PROFILE_ROW);
    storage.resolve.mockResolvedValue({ kind: 'redirect', url: 'https://signed.example/photo' });

    await expect(service.resolveProfilePhoto('7', CLASSROOM_LINK_ACTOR)).resolves.toEqual({
      kind: 'redirect',
      url: 'https://signed.example/photo',
    });
    expect(storage.resolve).toHaveBeenCalledWith('teachers/7/photo.webp');
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
    expect(repository.lockHomeroomClassroomsForTeacher).toHaveBeenCalledWith(
      '7',
      expect.anything(),
    );
    expect(repository.lockHomeroomClassroomsForTeacher.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findTeacherById.mock.invocationCallOrder[0],
    );
  });
});

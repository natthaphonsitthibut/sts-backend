import { ForbiddenException } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import type { ActorContext, QueryExecutor, StudentAccountCandidateRow } from './users.types';

const actor: ActorContext = {
  id: 5,
  username: 'school-admin',
  roles: ['ADMIN_SCHOOL'],
  permissions: ['manage-student-accounts'],
  data_scope: { school_ids: [10010002] },
};

const candidate: StudentAccountCandidateRow = {
  student_uuid: '00000000-0000-4000-8000-000000000001',
  person_uuid: '11111111-1111-4111-8111-111111111111',
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  school_id: 10010002,
  school_name: 'โรงเรียนทดสอบ',
  grade_label: 'ม.6',
  grade_level_id: 6,
  room_id: 1,
  academic_year: 2569,
  semester: 1,
  existing_user_id: null,
  existing_username: null,
};

describe('UsersService student accounts', () => {
  const executor: QueryExecutor = { query: jest.fn() };
  let usersRepository: jest.Mocked<
    Pick<
      UsersRepository,
      | 'countStudentAccountCandidates'
      | 'listStudentAccountCandidates'
      | 'withTransaction'
      | 'usernameExists'
      | 'createUser'
    >
  >;
  let usersPolicyService: jest.Mocked<Pick<UsersPolicyService, 'ensureActor'>>;
  let passwordService: jest.Mocked<Pick<PasswordService, 'generateTempPassword' | 'hash'>>;
  let service: UsersService;

  beforeEach(() => {
    usersRepository = {
      countStudentAccountCandidates: jest.fn().mockResolvedValue({
        totalCount: 1,
        withoutAccountCount: 1,
        existingAccountCount: 0,
      }),
      listStudentAccountCandidates: jest.fn().mockResolvedValue([candidate]),
      withTransaction: jest.fn(
        async (callback: (executor: QueryExecutor) => Promise<unknown>) => await callback(executor),
      ),
      usernameExists: jest.fn().mockResolvedValue(false),
      createUser: jest.fn().mockResolvedValue(77),
    };
    usersPolicyService = {
      ensureActor: jest.fn().mockImplementation((value: ActorContext | undefined) => {
        if (!value) throw new ForbiddenException('ไม่ได้เข้าสู่ระบบ');
        return value;
      }),
    };
    passwordService = {
      generateTempPassword: jest.fn().mockReturnValue('TEMP123456789'),
      hash: jest.fn().mockResolvedValue('hashed-temp-password'),
    };
    service = new UsersService(
      usersRepository as unknown as UsersRepository,
      usersPolicyService as unknown as UsersPolicyService,
      passwordService as unknown as PasswordService,
    );
  });

  it('rejects actors without manage-student-accounts', async () => {
    await expect(
      service.previewStudentAccounts({ ...actor, permissions: ['manage-users-list'] }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('previews scoped candidates without exposing canonical person identifiers', async () => {
    const result = await service.previewStudentAccounts(actor, { schoolId: 10010002 });

    expect(result.data.summary.withoutAccountCount).toBe(1);
    expect(result.data.candidates[0]).toMatchObject({
      studentName: 'สมชาย ใจดี',
      schoolId: 10010002,
      grade: 'ม.6',
      room: 1,
      hasActiveAccount: false,
    });
    expect(JSON.stringify(result)).not.toContain(candidate.person_uuid);
  });

  it('generates student users with own-only scope and one-time temporary passwords', async () => {
    const result = await service.generateStudentAccounts(actor, { schoolId: 10010002, limit: 1 });

    expect(result.createdCount).toBe(1);
    expect(result.credentials[0]).toMatchObject({
      userId: 77,
      tempPassword: 'TEMP123456789',
      studentName: 'สมชาย ใจดี',
    });
    expect(typeof result.credentials[0].temporaryPasswordIssuedAt).toBe('string');
    expect(typeof result.credentials[0].temporaryPasswordExpiresAt).toBe('string');
    expect(new Date(result.credentials[0].temporaryPasswordExpiresAt).getTime()).toBeGreaterThan(
      new Date(result.credentials[0].temporaryPasswordIssuedAt).getTime(),
    );
    expect(result.credentials[0].username).toMatch(/^10010002-[A-Z2-9]{5}$/);
    expect(usersRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: 'hashed-temp-password',
        personIdOnec: '',
        personUuid: candidate.person_uuid,
        role: 'STUDENT',
        permissions: ['home', 'student-self'],
        dataScope: { own_only: true },
        mustChangePassword: true,
        createdBy: 5,
      }),
      executor,
    );
    expect(usersRepository.createUser.mock.calls[0][0].temporaryPasswordIssuedAt).toBeInstanceOf(
      Date,
    );
    expect(usersRepository.createUser.mock.calls[0][0].temporaryPasswordExpiresAt).toBeInstanceOf(
      Date,
    );
  });
});

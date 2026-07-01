import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PasswordService } from '../auth/password.service';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import type {
  ActorContext,
  QueryExecutor,
  StudentAccountCandidateRow,
  StudentAccountManagementRow,
} from './users.types';

const actor: ActorContext = {
  id: 5,
  username: 'school-admin',
  roles: ['ADMIN'],
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

const studentAccount: StudentAccountManagementRow = {
  user_id: 77,
  username: '10010002-ABCDE',
  status: 'ACTIVE',
  must_change_password: true,
  temporary_password_issued_at: new Date('2026-06-29T00:00:00.000Z'),
  temporary_password_expires_at: new Date('2026-07-06T00:00:00.000Z'),
  created_at: new Date('2026-06-29T00:00:00.000Z'),
  person_uuid: candidate.person_uuid,
  student_uuid: candidate.student_uuid,
  first_name: candidate.first_name,
  last_name: candidate.last_name,
  school_id: candidate.school_id,
  school_name: candidate.school_name,
  grade_label: candidate.grade_label,
  grade_level_id: candidate.grade_level_id,
  room_id: candidate.room_id,
  academic_year: candidate.academic_year,
  semester: candidate.semester,
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
      | 'findUserById'
      | 'listStudentAccountsPaginated'
      | 'countStudentAccountStatuses'
      | 'findStudentAccountForManagement'
      | 'reissueTemporaryPassword'
      | 'deactivateUser'
      | 'reactivateUser'
      | 'countActiveUsersByRole'
      | 'listUserOperationalReferences'
      | 'deleteUser'
    >
  >;
  let usersPolicyService: jest.Mocked<
    Pick<
      UsersPolicyService,
      'ensureActor' | 'getRoleMap' | 'hydrateUserPermissions' | 'canManageUser'
    >
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'generateTempPassword' | 'hash'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'recordAtomic'>>;
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
      findUserById: jest.fn().mockResolvedValue({ id: 77 }),
      listStudentAccountsPaginated: jest
        .fn()
        .mockResolvedValue({ rows: [studentAccount], totalCount: 1 }),
      countStudentAccountStatuses: jest.fn().mockResolvedValue({
        PENDING_FIRST_LOGIN: 1,
        ACTIVE: 0,
        TEMP_PASSWORD_EXPIRED: 0,
        DISABLED: 0,
      }),
      findStudentAccountForManagement: jest.fn().mockResolvedValue(studentAccount),
      reissueTemporaryPassword: jest.fn().mockResolvedValue(true),
      deactivateUser: jest.fn().mockResolvedValue(true),
      reactivateUser: jest.fn().mockResolvedValue(true),
      countActiveUsersByRole: jest.fn().mockResolvedValue(2),
      listUserOperationalReferences: jest.fn().mockResolvedValue([]),
      deleteUser: jest.fn().mockResolvedValue(1),
    };
    usersPolicyService = {
      ensureActor: jest.fn().mockImplementation((value: ActorContext | undefined) => {
        if (!value) throw new ForbiddenException('ไม่ได้เข้าสู่ระบบ');
        return value;
      }),
      getRoleMap: jest.fn().mockResolvedValue(new Map()),
      hydrateUserPermissions: jest.fn().mockReturnValue({
        id: 77,
        username: '10010002-ABCDE',
        role: 'STUDENT',
        roles: ['STUDENT'],
        permissions: ['home', 'student-self'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002], own_only: true },
      }),
      canManageUser: jest.fn().mockReturnValue(true),
    };
    passwordService = {
      generateTempPassword: jest.fn().mockReturnValue('TEMP123456789'),
      hash: jest.fn().mockResolvedValue('hashed-temp-password'),
    };
    auditLog = {
      recordAtomic: jest.fn().mockResolvedValue(undefined),
    };
    service = new UsersService(
      usersRepository as unknown as UsersRepository,
      usersPolicyService as unknown as UsersPolicyService,
      passwordService as unknown as PasswordService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('rejects actors without manage-student-accounts', async () => {
    await expect(
      service.previewStudentAccounts({ ...actor, permissions: ['manage-users-list'] }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes geo filters and pagination to student account preview queries', async () => {
    await service.previewStudentAccounts(actor, {
      province: 'กรุงเทพมหานคร',
      district: 'ดอนเมือง',
      subDistrict: 'สีกัน',
      page: 2,
      limit: 20,
    });

    expect(usersRepository.countStudentAccountCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        province: 'กรุงเทพมหานคร',
        district: 'ดอนเมือง',
        subDistrict: 'สีกัน',
        page: 2,
        limit: 20,
      }),
    );
    expect(usersRepository.listStudentAccountCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        province: 'กรุงเทพมหานคร',
        district: 'ดอนเมือง',
        subDistrict: 'สีกัน',
        page: 2,
        limit: 20,
      }),
    );
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

  it('lists scoped student accounts with derived management status', async () => {
    const result = await service.listStudentAccounts(actor, { schoolId: 10010002 });

    expect(usersRepository.listStudentAccountsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        actorScope: actor.data_scope,
        schoolId: 10010002,
        page: 1,
        limit: 20,
      }),
    );
    expect(usersRepository.countStudentAccountStatuses).toHaveBeenCalledWith(
      expect.objectContaining({
        actorScope: actor.data_scope,
        schoolId: 10010002,
      }),
    );
    expect(result.data[0]).toMatchObject({
      userId: 77,
      username: '10010002-ABCDE',
      studentName: 'สมชาย ใจดี',
      schoolId: 10010002,
      status: 'PENDING_FIRST_LOGIN',
      accountStatus: 'ACTIVE',
      mustChangePassword: true,
    });
    expect(result.meta.statusCounts).toMatchObject({
      PENDING_FIRST_LOGIN: 1,
      ACTIVE: 0,
      TEMP_PASSWORD_EXPIRED: 0,
      DISABLED: 0,
    });
    expect(JSON.stringify(result)).not.toContain(candidate.person_uuid);
  });

  it('rejects generation when there are no accounts to create', async () => {
    usersRepository.listStudentAccountCandidates.mockResolvedValueOnce([]);

    await expect(
      service.generateStudentAccounts(actor, { schoolId: 10010002, limit: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usersRepository.createUser).not.toHaveBeenCalled();
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

  it('reissues a temporary password on the existing scoped student account', async () => {
    const result = await service.reissueStudentTemporaryPassword(actor, 77);

    expect(result).toMatchObject({
      success: true,
      userId: 77,
      username: '10010002-ABCDE',
      tempPassword: 'TEMP123456789',
    });
    expect(usersRepository.reissueTemporaryPassword).toHaveBeenCalledWith(
      77,
      'hashed-temp-password',
      expect.any(Date),
      expect.any(Date),
    );
    expect(usersRepository.createUser).not.toHaveBeenCalled();
  });

  it('reissues a temporary password for a manageable non-student account', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher-one',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['home', 'attendance'],
      status: 'ACTIVE',
      data_scope: { school_ids: [10010002] },
    });

    const result = await service.reissueTemporaryPassword(actor, 77);

    expect(usersPolicyService.canManageUser).toHaveBeenCalled();
    expect(usersRepository.reissueTemporaryPassword).toHaveBeenCalledWith(
      77,
      'hashed-temp-password',
      expect.any(Date),
      expect.any(Date),
    );
    expect(result).toMatchObject({
      success: true,
      userId: 77,
      username: 'teacher-one',
      tempPassword: 'TEMP123456789',
    });
  });

  it('rejects temporary-password reissue outside the actor management scope', async () => {
    usersPolicyService.canManageUser.mockReturnValueOnce(false);

    await expect(service.reissueTemporaryPassword(actor, 77)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(usersRepository.reissueTemporaryPassword).not.toHaveBeenCalled();
  });

  it('rejects lifecycle status changes through the generic user update path', async () => {
    await expect(service.updateUser(actor, 77, { status: 'DISABLED' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(usersRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('blocks hard delete without the break-glass permission', async () => {
    await expect(service.deleteUser(actor, 77)).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersRepository.listUserOperationalReferences).not.toHaveBeenCalled();
    expect(usersRepository.deleteUser).not.toHaveBeenCalled();
  });

  it('blocks hard delete of an active account', async () => {
    await expect(
      service.deleteUser({ ...actor, permissions: ['manage-users-hard-delete'] }, 77),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usersRepository.listUserOperationalReferences).not.toHaveBeenCalled();
    expect(usersRepository.deleteUser).not.toHaveBeenCalled();
  });

  it('blocks hard delete when operational references exist', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher-one',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['home', 'attendance'],
      status: 'DISABLED',
      data_scope: { school_ids: [10010002] },
    });
    usersRepository.listUserOperationalReferences.mockResolvedValueOnce([
      'audit_log.actor_user_id',
    ]);

    await expect(
      service.deleteUser({ ...actor, permissions: ['manage-users-hard-delete'] }, 77),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usersRepository.listUserOperationalReferences).toHaveBeenCalledWith(77, executor);
    expect(usersRepository.deleteUser).not.toHaveBeenCalled();
  });

  it('hard deletes a disabled account with no operational references', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher-one',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['home', 'attendance'],
      status: 'DISABLED',
      data_scope: { school_ids: [10010002] },
    });

    const result = await service.deleteUser(
      { ...actor, permissions: ['manage-users-hard-delete'] },
      77,
    );

    expect(usersRepository.listUserOperationalReferences).toHaveBeenCalledWith(77, executor);
    expect(usersRepository.deleteUser).toHaveBeenCalledWith(77, executor);
    expect(result).toEqual({ success: true, rowCount: 1 });
  });

  it('bulk reissues selected student accounts and returns one-time credentials', async () => {
    const result = await service.bulkReissueStudentTemporaryPasswords(actor, {
      userIds: [77],
      page: 3,
    });

    expect(usersRepository.listStudentAccountsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        actorScope: actor.data_scope,
        userIds: [77],
        page: 1,
        limit: 200,
      }),
    );
    expect(result).toMatchObject({
      success: true,
      requestedCount: 1,
      reissuedCount: 1,
      skippedCount: 0,
    });
    expect(result.credentials[0]).toMatchObject({
      userId: 77,
      username: '10010002-ABCDE',
      tempPassword: 'TEMP123456789',
      studentName: 'สมชาย ใจดี',
    });
    expect(usersRepository.reissueTemporaryPassword).toHaveBeenCalledWith(
      77,
      'hashed-temp-password',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('soft-deactivates a scoped active student account', async () => {
    const result = await service.deactivateStudentAccount(actor, 77, {
      reasonCode: 'TRANSFERRED',
      note: 'ย้ายโรงเรียน',
    });

    expect(usersRepository.findStudentAccountForManagement).toHaveBeenCalledWith(
      77,
      actor.data_scope,
    );
    expect(usersRepository.deactivateUser).toHaveBeenCalledWith(
      {
        id: 77,
        actorId: 5,
        reasonCode: 'TRANSFERRED',
        note: 'ย้ายโรงเรียน',
      },
      executor,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STUDENT_ACCOUNT_DEACTIVATE',
        actorUserId: 5,
        targetId: '77',
        metadata: {
          username: '10010002-ABCDE',
          reasonCode: 'TRANSFERRED',
          note: 'ย้ายโรงเรียน',
          reason: 'ย้ายโรงเรียน',
        },
      }),
      executor,
    );
    expect(result).toMatchObject({
      success: true,
      userId: 77,
      status: 'DISABLED',
      reasonCode: 'TRANSFERRED',
      note: 'ย้ายโรงเรียน',
    });
  });

  it('blocks self-deactivation before mutating', async () => {
    await expect(
      service.deactivateAccount(
        { ...actor, id: 77 },
        77,
        { reasonCode: 'OTHER' },
        {
          action: 'USER_DEACTIVATE',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersRepository.deactivateUser).not.toHaveBeenCalled();
    expect(auditLog.recordAtomic).not.toHaveBeenCalled();
  });

  it('blocks account deactivation outside the actor management scope', async () => {
    usersPolicyService.canManageUser.mockReturnValueOnce(false);

    await expect(
      service.deactivateAccount(actor, 77, { reasonCode: 'OTHER' }, { action: 'USER_DEACTIVATE' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersRepository.deactivateUser).not.toHaveBeenCalled();
  });

  it('blocks deactivating the last active super admin', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'admin-one',
      role: 'ADMIN',
      roles: ['ADMIN'],
      permissions: ['manage-users-list'],
      status: 'ACTIVE',
      data_scope: {},
    });
    usersRepository.countActiveUsersByRole.mockResolvedValueOnce(1);

    await expect(
      service.deactivateAccount(
        actor,
        77,
        { reasonCode: 'SECURITY' },
        {
          action: 'USER_DEACTIVATE',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usersRepository.countActiveUsersByRole).toHaveBeenCalledWith('ADMIN', executor, {
      lockRows: true,
    });
    expect(usersRepository.deactivateUser).not.toHaveBeenCalled();
  });

  it('reactivates a disabled manageable account and signals expired temporary password', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher-one',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['home', 'attendance'],
      status: 'DISABLED',
      data_scope: { school_ids: [10010002] },
      must_change_password: true,
      temporary_password_expires_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.reactivateAccount(actor, 77, { action: 'USER_REACTIVATE' });

    expect(usersRepository.reactivateUser).toHaveBeenCalledWith(77, executor);
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_REACTIVATE',
        actorUserId: 5,
        targetId: '77',
      }),
      executor,
    );
    expect(result).toEqual({
      success: true,
      userId: 77,
      status: 'ACTIVE',
      needsReissue: true,
    });
  });
});

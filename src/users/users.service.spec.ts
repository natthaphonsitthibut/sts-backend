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
  temporary_password_expires_at: new Date('2099-07-06T00:00:00.000Z'),
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
      | 'findOwnProfileById'
      | 'findCurrentStudentUuidByUserId'
      | 'findSchoolNamesByIds'
      | 'listStudentAccountsPaginated'
      | 'countStudentAccountStatuses'
      | 'findStudentAccountForManagement'
      | 'reissueTemporaryPassword'
      | 'deactivateUser'
      | 'reactivateUser'
      | 'countActiveUsersByRole'
      | 'listUserOperationalReferences'
      | 'deleteUser'
      | 'updateOwnProfile'
      | 'hasActiveUserAddressReveal'
      | 'insertUserAddressAccessEvent'
      | 'hasActiveUserNationalIdReveal'
      | 'insertUserNationalIdAccessEvent'
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
      findOwnProfileById: jest.fn().mockResolvedValue({ id: 77 }),
      findCurrentStudentUuidByUserId: jest.fn().mockResolvedValue(null),
      findSchoolNamesByIds: jest.fn().mockResolvedValue([{ id: 10010002, name: 'โรงเรียนทดสอบ' }]),
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
      updateOwnProfile: jest.fn().mockResolvedValue(undefined),
      hasActiveUserAddressReveal: jest.fn().mockResolvedValue(false),
      insertUserAddressAccessEvent: jest.fn().mockResolvedValue(undefined),
      hasActiveUserNationalIdReveal: jest.fn().mockResolvedValue(false),
      insertUserNationalIdAccessEvent: jest.fn().mockResolvedValue(undefined),
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
        FirstName: 'สมชาย',
        LastName: 'ใจดี',
        phone: null,
        email: null,
        affiliation: 'โรงเรียนทดสอบ',
        line_id: null,
        address_line: null,
        address_sub_district: null,
        address_district: null,
        address_province: null,
        address_postal_code: null,
        address_latitude: null,
        address_longitude: null,
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
      {
        hashPepper: 'test-pii-hash-pepper',
        hashKeyVersion: 1,
        revealTtlSeconds: 900,
      },
    );
  });

  it('rejects actors without manage-student-accounts', async () => {
    await expect(
      service.previewStudentAccounts({ ...actor, permissions: ['manage-users-list'] }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns minimized user detail without identity or address fields', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher-one',
      FirstName: 'ครู',
      LastName: 'ใจดี',
      PersonID_Onec: '1234567890123',
      phone: '0812345678',
      email: 'teacher@example.test',
      affiliation: 'โรงเรียนทดสอบ',
      line_id: 'teacher.line',
      address_line: '99/1',
      address_sub_district: 'บ้านสวน',
      address_district: 'เมืองชลบุรี',
      address_province: 'ชลบุรี',
      address_postal_code: '20000',
      address_latitude: 13.3611,
      address_longitude: 100.9847,
      role: 'TEACHER',
      roles: ['TEACHER'],
      labels: ['คุณครู'],
      permissions: ['home', 'students'],
      status: 'ACTIVE',
      data_scope: { school_ids: [10010002] },
    });

    const detail = await service.getUserDetailById(77, {
      ...actor,
      permissions: ['manage-users-list'],
    });

    expect(detail).toEqual(
      expect.objectContaining({
        id: 77,
        username: 'teacher-one',
        phone: '0812345678',
        role: 'TEACHER',
        data_scope_labels: { schools: [{ id: 10010002, name: 'โรงเรียนทดสอบ' }] },
        has_profile_location: true,
      }),
    );
    expect(usersRepository.findSchoolNamesByIds).toHaveBeenCalledWith([10010002]);
    expect(detail).toHaveProperty('PersonID_Onec', '•••••••••••••');
    expect(detail).toHaveProperty('line_id', 'teacher.line');
    expect(detail).not.toHaveProperty('address_line');
    expect(detail).not.toHaveProperty('address_latitude');
  });

  it('reveals a managed user address and records an access event', async () => {
    usersRepository.findOwnProfileById.mockResolvedValueOnce({
      id: 77,
      address_line: '99/1',
      address_sub_district: 'บ้านสวน',
      address_district: 'เมืองชลบุรี',
      address_province: 'ชลบุรี',
      address_postal_code: '20000',
      address_latitude: 13.3611,
      address_longitude: 100.9847,
    });

    const result = await service.revealUserAddress(
      77,
      { ...actor, permissions: ['manage-users-list'] },
      { reason_code: 'VERIFY_DATA' },
      { ip: null, userAgent: null, requestId: 'request-1' },
    );

    expect(result.address_line).toBe('99/1');
    expect(usersRepository.insertUserAddressAccessEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actor.id, reasonCode: 'VERIFY_DATA' }),
    );
  });

  it('reveals a managed user national id only after an audited reason', async () => {
    usersRepository.findOwnProfileById.mockResolvedValueOnce({
      id: 77,
      PersonID_Onec: '1234567890123',
    });
    usersRepository.hasActiveUserNationalIdReveal.mockResolvedValueOnce(false);

    const result = await service.revealUserNationalId(
      77,
      { ...actor, permissions: ['manage-users-list'] },
      { reason_code: 'VERIFY_DATA' },
      { ip: null, userAgent: null, requestId: 'request-1' },
    );

    expect(result).toEqual({ PersonID_Onec: '1234567890123' });
    expect(usersRepository.insertUserNationalIdAccessEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actor.id, reasonCode: 'VERIFY_DATA' }),
    );
  });

  it('denies national-id reveal outside the actor management scope', async () => {
    usersPolicyService.canManageUser.mockReturnValueOnce(false);

    await expect(
      service.revealUserNationalId(
        77,
        { ...actor, permissions: ['manage-users-list'] },
        { reason_code: 'VERIFY_DATA' },
        { ip: null, userAgent: null, requestId: 'request-1' },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(usersRepository.findOwnProfileById).not.toHaveBeenCalled();
    expect(usersRepository.insertUserNationalIdAccessEvent).not.toHaveBeenCalled();
  });

  it('updates only the authenticated user profile fields', async () => {
    const selfActor = { ...actor, id: 77, permissions: ['home'] };
    usersRepository.findOwnProfileById
      .mockResolvedValueOnce({ id: 77 } as never)
      .mockResolvedValueOnce({ id: 77 } as never);
    usersPolicyService.hydrateUserPermissions
      .mockReturnValueOnce({
        id: 77,
        username: 'teacher-one',
        FirstName: 'ครู',
        LastName: 'เดิม',
        phone: null,
        email: null,
        affiliation: 'โรงเรียนเดิม',
        line_id: null,
        address_line: null,
        address_sub_district: null,
        address_district: null,
        address_province: null,
        address_postal_code: null,
        address_latitude: null,
        address_longitude: null,
        roles: ['TEACHER'],
        permissions: ['home'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002] },
      })
      .mockReturnValueOnce({
        id: 77,
        username: 'teacher-one',
        FirstName: 'ครู',
        LastName: 'ใหม่',
        line_id: 'teacher.line',
        roles: ['TEACHER'],
        permissions: ['home'],
        status: 'ACTIVE',
      });

    await expect(
      service.updateOwnProfile(selfActor, {
        FirstName: ' ครู ',
        LastName: ' ใหม่ ',
        phone: '0812345678',
        email: 'teacher@example.test',
        affiliation: ' โรงเรียนทดสอบ ',
        line_id: ' teacher.line ',
        address_line: ' 99/1 ',
        address_village_no: ' หมู่ 5 ',
        address_street: ' ประชาราษฎร์ ',
        address_soi: ' สุขใจ 2 ',
        address_trok: ' วัดใหม่ ',
        address_sub_district: ' บ้านสวน ',
        address_district: ' เมืองชลบุรี ',
        address_province: ' ชลบุรี ',
        address_postal_code: '20000',
        address_latitude: 13.3611,
        address_longitude: 100.9847,
      }),
    ).resolves.toMatchObject({
      id: 77,
      FirstName: 'ครู',
      LastName: 'ใหม่',
      line_id: 'teacher.line',
    });

    expect(usersRepository.updateOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 77,
        firstName: 'ครู',
        lastName: 'ใหม่',
        phone: '0812345678',
        email: 'teacher@example.test',
        affiliation: 'โรงเรียนทดสอบ',
        lineId: 'teacher.line',
        addressLine: '99/1',
        addressVillageNo: '5',
        addressStreet: 'ประชาราษฎร์',
        addressSoi: 'สุขใจ 2',
        addressTrok: 'วัดใหม่',
        addressSubDistrict: 'บ้านสวน',
        addressDistrict: 'เมืองชลบุรี',
        addressProvince: 'ชลบุรี',
        addressPostalCode: '20000',
        addressLatitude: 13.3611,
        addressLongitude: 100.9847,
        updatedBy: 77,
      }),
    );
  });

  it('rejects self profile updates that clear required display names', async () => {
    usersRepository.findOwnProfileById.mockResolvedValueOnce({ id: 77 } as never);

    await expect(
      service.updateOwnProfile({ ...actor, id: 77 }, { FirstName: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersRepository.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('rejects self profile updates with an incomplete coordinate pair', async () => {
    usersRepository.findOwnProfileById.mockResolvedValueOnce({ id: 77 } as never);
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      FirstName: 'ครู',
      LastName: 'ทดสอบ',
      address_latitude: null,
      address_longitude: null,
    });

    await expect(
      service.updateOwnProfile({ ...actor, id: 77 }, { address_latitude: 13.7563 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersRepository.updateOwnProfile).not.toHaveBeenCalled();
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

  it('rejects student account filters that specify room without grade', async () => {
    await expect(
      service.previewStudentAccounts(actor, { schoolId: 10010002, room: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listStudentAccounts(actor, { schoolId: 10010002, room: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.generateStudentAccounts(actor, { schoolId: 10010002, room: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersRepository.countStudentAccountCandidates).not.toHaveBeenCalledWith(
      expect.objectContaining({ room: 1 }),
    );
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
          schoolId: 10010002,
          schoolName: 'โรงเรียนทดสอบ',
          grade: 'ม.6',
          room: 1,
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

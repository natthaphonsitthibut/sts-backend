import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PasswordService } from '../auth/password.service';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import type { FileStorageAdapter } from '../files/storage/file-storage.types';
import type { ActorContext, QueryExecutor } from './users.types';

const actor: ActorContext = {
  id: 5,
  username: 'school-admin',
  roles: ['ADMIN'],
  permissions: ['manage-users-list'],
  data_scope: { school_ids: [10010002] },
};

describe('UsersService', () => {
  const executor: QueryExecutor = { query: jest.fn() };
  let usersRepository: jest.Mocked<
    Pick<
      UsersRepository,
      | 'withTransaction'
      | 'usernameExists'
      | 'createUser'
      | 'updateUser'
      | 'reconcileTeacherMemberships'
      | 'findUserById'
      | 'findOwnProfileById'
      | 'findResolvedNationalIdByUserId'
      | 'findStudentPersonContactByUserId'
      | 'findCurrentStudentUuidByUserId'
      | 'findSchoolNamesByIds'
      | 'findGradeLevelLabelsByIds'
      | 'reissueTemporaryPassword'
      | 'deactivateUser'
      | 'reactivateUser'
      | 'countActiveUsersByRole'
      | 'listUserOperationalReferences'
      | 'deleteUser'
      | 'updateOwnProfile'
      | 'upsertStudentPersonContact'
      | 'hasActiveUserAddressReveal'
      | 'insertUserAddressAccessEvent'
      | 'hasActiveUserNationalIdReveal'
      | 'insertUserNationalIdAccessEvent'
      | 'listUsersPaginated'
    >
  >;
  let usersPolicyService: jest.Mocked<
    Pick<
      UsersPolicyService,
      | 'ensureActor'
      | 'getRoleMap'
      | 'hydrateUserPermissions'
      | 'canManageUser'
      | 'assertAssignablePayload'
      | 'normalizePermissionList'
      | 'normalizeRole'
      | 'getPrimaryRole'
      | 'getRoleRank'
    >
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'generateTempPassword' | 'hash'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'recordAtomic' | 'record'>>;
  let fileStorage: jest.Mocked<FileStorageAdapter>;
  let service: UsersService;

  beforeEach(() => {
    usersRepository = {
      withTransaction: jest.fn(
        async (callback: (executor: QueryExecutor) => Promise<unknown>) => await callback(executor),
      ),
      usernameExists: jest.fn().mockResolvedValue(false),
      createUser: jest.fn().mockResolvedValue(77),
      updateUser: jest.fn().mockResolvedValue(undefined),
      reconcileTeacherMemberships: jest
        .fn()
        .mockResolvedValue({ activatedSchoolIds: [], endedSchoolIds: [] }),
      findUserById: jest.fn().mockResolvedValue({ id: 77 }),
      findOwnProfileById: jest.fn().mockResolvedValue({ id: 77 }),
      findResolvedNationalIdByUserId: jest.fn().mockResolvedValue(null),
      findStudentPersonContactByUserId: jest.fn().mockResolvedValue({
        person_uuid: '11111111-1111-4111-8111-111111111111',
        has_canonical_contact: true,
        phone: null,
        email: null,
        line_id: null,
      }),
      findCurrentStudentUuidByUserId: jest.fn().mockResolvedValue(null),
      findSchoolNamesByIds: jest.fn().mockResolvedValue([{ id: 10010002, name: 'โรงเรียนทดสอบ' }]),
      findGradeLevelLabelsByIds: jest.fn().mockResolvedValue([{ id: 11, label: 'อ.1' }]),
      reissueTemporaryPassword: jest.fn().mockResolvedValue(true),
      deactivateUser: jest.fn().mockResolvedValue(true),
      reactivateUser: jest.fn().mockResolvedValue(true),
      countActiveUsersByRole: jest.fn().mockResolvedValue(2),
      listUserOperationalReferences: jest.fn().mockResolvedValue([]),
      deleteUser: jest.fn().mockResolvedValue(1),
      updateOwnProfile: jest.fn().mockResolvedValue(undefined),
      upsertStudentPersonContact: jest.fn().mockResolvedValue(undefined),
      hasActiveUserAddressReveal: jest.fn().mockResolvedValue(false),
      insertUserAddressAccessEvent: jest.fn().mockResolvedValue(undefined),
      hasActiveUserNationalIdReveal: jest.fn().mockResolvedValue(false),
      insertUserNationalIdAccessEvent: jest.fn().mockResolvedValue(undefined),
      listUsersPaginated: jest.fn().mockResolvedValue({
        rows: [],
        totalCount: 0,
        lifecycleStatusCounts: {},
      }),
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
        permissions: ['student-self'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002], own_only: true },
      }),
      canManageUser: jest.fn().mockReturnValue(true),
      assertAssignablePayload: jest.fn().mockResolvedValue(undefined),
      normalizePermissionList: jest
        .fn()
        .mockImplementation((permissions?: string[]) => permissions ?? []),
      normalizeRole: jest
        .fn()
        .mockImplementation(
          (value: { role?: string; roles?: string[] }) =>
            value.role || value.roles?.[0] || 'STUDENT',
        ),
      getPrimaryRole: jest
        .fn()
        .mockImplementation(
          (value: { role?: string; roles?: string[] }) =>
            value.role || value.roles?.[0] || 'STUDENT',
        ),
      getRoleRank: jest.fn().mockReturnValue(100),
    };
    passwordService = {
      generateTempPassword: jest.fn().mockReturnValue('TEMP123456789'),
      hash: jest.fn().mockResolvedValue('hashed-temp-password'),
    };
    auditLog = {
      recordAtomic: jest.fn().mockResolvedValue(undefined),
      record: jest.fn().mockResolvedValue(undefined),
    };
    fileStorage = {
      kind: 'local',
      save: jest.fn().mockResolvedValue(undefined),
      saveStream: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(null),
      open: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
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
      fileStorage,
    );
  });

  it('returns guarded profile URLs in the managed-user list without leaking storage keys', async () => {
    const updatedAt = '2026-08-10T06:30:00.000Z';
    usersRepository.listUsersPaginated.mockResolvedValueOnce({
      rows: [
        {
          id: 77,
          username: 'director.one',
          FirstName: 'กะลา',
          LastName: 'หลบ',
          photo_storage_key: 'user-photos/77/profile.webp',
          updated_at: updatedAt,
          role: 'DIRECTOR',
          roles: ['DIRECTOR'],
          permissions: ['manage-users-list'],
          data_scope: { school_ids: [10010002] },
        },
      ] as never,
      totalCount: 1,
      lifecycleStatusCounts: {} as never,
    });
    usersPolicyService.hydrateUserPermissions.mockImplementationOnce((row) => row);

    const result = await service.getAllUsers(actor, { page: 1, limit: 20 });

    expect(result.data[0]).toMatchObject({
      id: 77,
      photo_url: `/api/users/77/photo?v=${encodeURIComponent(updatedAt)}`,
    });
    expect(JSON.stringify(result)).not.toContain('user-photos/77/profile.webp');
    expect(result.data[0]).not.toHaveProperty('photo_storage_key');
  });

  it('creates the teacher account and school membership in one transaction', async () => {
    usersRepository.reconcileTeacherMemberships.mockResolvedValueOnce({
      activatedSchoolIds: [10010002],
      endedSchoolIds: [],
    });

    await expect(
      service.createUser(actor, {
        username: 'teacher.one',
        FirstName: 'ครู',
        LastName: 'หนึ่ง',
        PersonID_Onec: '1234567890123',
        role: 'TEACHER',
        roles: ['TEACHER'],
        permissions: ['attendance'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002] },
      }),
    ).resolves.toMatchObject({ success: true, userId: 77 });

    expect(usersRepository.reconcileTeacherMemberships).toHaveBeenCalledWith(
      {
        teacherUserId: 77,
        schoolIds: [10010002],
        actorUserId: actor.id,
      },
      executor,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MASTER_DATA_EDIT',
        targetType: 'school_teacher_memberships',
      }),
      executor,
    );
    expect(usersRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        mustChangePassword: true,
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

  it('creates an immediately active account when the administrator supplies a password', async () => {
    const result = await service.createUser(actor, {
      username: 'teacher.with-password',
      password: 'PERMANENT_PASSWORD_PLACEHOLDER',
      FirstName: 'ครู',
      LastName: 'พร้อมใช้งาน',
      PersonID_Onec: '1234567890123',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['attendance'],
      status: 'ACTIVE',
      data_scope: { school_ids: [10010002] },
    });

    expect(result).toEqual({
      success: true,
      userId: 77,
      tempPassword: undefined,
      must_change_password: false,
    });
    expect(passwordService.generateTempPassword).not.toHaveBeenCalled();
    expect(passwordService.hash).toHaveBeenCalledWith('PERMANENT_PASSWORD_PLACEHOLDER');
    expect(usersRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: 'hashed-temp-password',
        mustChangePassword: false,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
      }),
      executor,
    );
  });

  it('rejects a duplicate username with a user-facing conflict message', async () => {
    usersRepository.usernameExists.mockResolvedValueOnce(true);

    await expect(
      service.createUser(actor, {
        username: 'teacher.one',
        FirstName: 'ครู',
        LastName: 'ชื่อซ้ำ',
        PersonID_Onec: '1234567890123',
        role: 'TEACHER',
        roles: ['TEACHER'],
        permissions: ['attendance'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002] },
      }),
    ).rejects.toThrow('ชื่อผู้ใช้งานนี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น');

    expect(passwordService.hash).not.toHaveBeenCalled();
    expect(usersRepository.createUser).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate username insert to a conflict response', async () => {
    usersRepository.createUser.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'users_username_key',
      }),
    );

    await expect(
      service.createUser(actor, {
        username: 'teacher.race',
        FirstName: 'ครู',
        LastName: 'ชื่อชนกัน',
        PersonID_Onec: '1234567890123',
        role: 'TEACHER',
        roles: ['TEACHER'],
        permissions: ['attendance'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002] },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not mislabel another unique constraint as a duplicate username', async () => {
    const databaseError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'uq_school_teacher_memberships_active',
    });
    usersRepository.createUser.mockRejectedValueOnce(databaseError);

    await expect(
      service.createUser(actor, {
        username: 'teacher.other-conflict',
        FirstName: 'ครู',
        LastName: 'ข้อมูลชนกัน',
        PersonID_Onec: '1234567890123',
        role: 'TEACHER',
        roles: ['TEACHER'],
        permissions: ['attendance'],
        status: 'ACTIVE',
        data_scope: { school_ids: [10010002] },
      }),
    ).rejects.toBe(databaseError);
  });

  it('rejects a teacher account without an explicit school affiliation', async () => {
    await expect(
      service.createUser(actor, {
        username: 'teacher.no-school',
        FirstName: 'ครู',
        LastName: 'ไม่มีโรงเรียน',
        PersonID_Onec: '1234567890123',
        role: 'TEACHER',
        roles: ['TEACHER'],
        permissions: ['attendance'],
        status: 'ACTIVE',
        data_scope: { provinces: ['เชียงใหม่'] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(usersRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('keeps the teacher role and reconciles memberships when only the school scope changes', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher.one',
      FirstName: 'ครู',
      LastName: 'หนึ่ง',
      PersonID_Onec: '1234567890123',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['attendance'],
      status: 'ACTIVE',
      data_scope: { school_ids: [10010002] },
    } as never);
    usersRepository.findSchoolNamesByIds.mockResolvedValueOnce([
      { id: 10010003, name: 'โรงเรียนใหม่' },
    ]);

    await expect(
      service.updateUser(actor, 77, { data_scope: { school_ids: [10010003] } }),
    ).resolves.toEqual({ success: true });

    expect(usersRepository.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 77, role: 'TEACHER', dataScope: { school_ids: [10010003] } }),
      executor,
    );
    expect(usersRepository.reconcileTeacherMemberships).toHaveBeenCalledWith(
      { teacherUserId: 77, schoolIds: [10010003], actorUserId: actor.id },
      executor,
    );
  });

  it('authorizes a partial teacher update against the existing school scope', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher.one',
      FirstName: 'ครู',
      LastName: 'หนึ่ง',
      PersonID_Onec: '1234567890123',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['attendance'],
      status: 'ACTIVE',
      data_scope: { school_ids: [10010002] },
    } as never);

    await expect(service.updateUser(actor, 77, { FirstName: 'ครูแก้ไข' })).resolves.toEqual({
      success: true,
    });

    expect(usersPolicyService.assertAssignablePayload).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        role: 'TEACHER',
        data_scope: { school_ids: [10010002] },
      }),
      { allowEqualRole: false },
      expect.any(Map),
    );
    expect(usersRepository.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 77,
        firstName: 'ครูแก้ไข',
        dataScope: { school_ids: [10010002] },
      }),
      executor,
    );
  });

  it('ends teacher memberships when the account changes to a non-teacher role', async () => {
    usersPolicyService.hydrateUserPermissions.mockReturnValueOnce({
      id: 77,
      username: 'teacher.one',
      FirstName: 'ครู',
      LastName: 'หนึ่ง',
      PersonID_Onec: '1234567890123',
      role: 'TEACHER',
      roles: ['TEACHER'],
      permissions: ['attendance'],
      status: 'ACTIVE',
      data_scope: { school_ids: [10010002] },
    } as never);
    usersRepository.reconcileTeacherMemberships.mockResolvedValueOnce({
      activatedSchoolIds: [],
      endedSchoolIds: [10010002],
    });

    await expect(
      service.updateUser(actor, 77, { role: 'ADMIN', data_scope: { global: true } }),
    ).resolves.toEqual({ success: true });

    expect(usersRepository.reconcileTeacherMemberships).toHaveBeenCalledWith(
      { teacherUserId: 77, schoolIds: [], actorUserId: actor.id },
      executor,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'school_teacher_memberships',
      }),
      executor,
    );
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
        data_scope_labels: {
          schools: [{ id: 10010002, name: 'โรงเรียนทดสอบ' }],
          gradeLevels: [{ id: 11, label: 'อ.1' }],
        },
        has_profile_location: true,
      }),
    );
    expect(usersRepository.findSchoolNamesByIds).toHaveBeenCalledWith([10010002]);
    expect(usersRepository.findGradeLevelLabelsByIds).toHaveBeenCalledWith([]);
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
      PersonID_Onec: '',
    });
    usersRepository.findResolvedNationalIdByUserId.mockResolvedValueOnce('1-2345-67890-12-3');
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
      executor,
    );
  });

  it('writes a student self-profile contact to the canonical person row', async () => {
    const selfActor = { ...actor, id: 77, roles: ['STUDENT'], permissions: ['student-self'] };
    usersRepository.findOwnProfileById.mockResolvedValue({ id: 77 } as never);
    usersRepository.findStudentPersonContactByUserId.mockResolvedValue({
      person_uuid: '11111111-1111-4111-8111-111111111111',
      has_canonical_contact: true,
      phone: '0811111111',
      email: null,
      line_id: null,
    });
    usersPolicyService.hydrateUserPermissions.mockReturnValue({
      id: 77,
      username: 'student-one',
      FirstName: 'สมชาย',
      LastName: 'ใจดี',
      phone: null,
      email: null,
      affiliation: 'โรงเรียนทดสอบ',
      line_id: null,
      address_latitude: null,
      address_longitude: null,
      roles: ['STUDENT'],
      permissions: ['student-self'],
      status: 'ACTIVE',
      data_scope: { own_only: true },
    });

    await service.updateOwnProfile(selfActor, { phone: '0822222222', line_id: 'student.line' });

    expect(usersRepository.upsertStudentPersonContact).toHaveBeenCalledWith(
      {
        personUuid: '11111111-1111-4111-8111-111111111111',
        phone: '0822222222',
        email: null,
        lineId: 'student.line',
        updatedBy: 77,
      },
      executor,
    );
  });

  it('does not restore cleared canonical contact from legacy user columns', async () => {
    const selfActor = { ...actor, id: 77, roles: ['STUDENT'], permissions: ['student-self'] };
    usersRepository.findOwnProfileById.mockResolvedValue({ id: 77 } as never);
    usersRepository.findStudentPersonContactByUserId.mockResolvedValue({
      person_uuid: '11111111-1111-4111-8111-111111111111',
      has_canonical_contact: true,
      phone: null,
      email: null,
      line_id: null,
    });
    usersPolicyService.hydrateUserPermissions.mockReturnValue({
      id: 77,
      username: 'student-one',
      FirstName: 'สมชาย',
      LastName: 'ใจดี',
      phone: '0999999999',
      email: 'legacy@example.test',
      affiliation: null,
      line_id: 'legacy.line',
      address_latitude: null,
      address_longitude: null,
      roles: ['STUDENT'],
      permissions: ['student-self'],
      status: 'ACTIVE',
      data_scope: { own_only: true },
    });

    await service.updateOwnProfile(selfActor, { affiliation: 'โรงเรียนทดสอบ' });

    expect(usersRepository.upsertStudentPersonContact).toHaveBeenCalledWith(
      expect.objectContaining({ phone: null, email: null, lineId: null }),
      executor,
    );
  });

  it('preserves legacy contact when a linked student has no canonical row yet', async () => {
    const selfActor = { ...actor, id: 77, roles: ['STUDENT'], permissions: ['student-self'] };
    usersRepository.findOwnProfileById.mockResolvedValue({ id: 77 } as never);
    usersRepository.findStudentPersonContactByUserId.mockResolvedValue({
      person_uuid: '11111111-1111-4111-8111-111111111111',
      has_canonical_contact: false,
      phone: null,
      email: null,
      line_id: null,
    });
    usersPolicyService.hydrateUserPermissions.mockReturnValue({
      id: 77,
      username: 'student-one',
      FirstName: 'สมชาย',
      LastName: 'ใจดี',
      phone: '0999999999',
      email: 'legacy@example.test',
      affiliation: null,
      line_id: 'legacy.line',
      address_latitude: null,
      address_longitude: null,
      roles: ['STUDENT'],
      permissions: ['student-self'],
      status: 'ACTIVE',
      data_scope: { own_only: true },
    });

    await service.updateOwnProfile(selfActor, { affiliation: 'โรงเรียนทดสอบ' });

    expect(usersRepository.upsertStudentPersonContact).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '0999999999',
        email: 'legacy@example.test',
        lineId: 'legacy.line',
      }),
      executor,
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

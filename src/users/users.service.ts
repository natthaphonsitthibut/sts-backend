import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService, type AuditAction } from '../audit-log/audit-log.service';
import { hasPermission } from '../auth/permissions.constants';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { PasswordService } from '../auth/password.service';
import type {
  AccountDeactivationReasonCode,
  BulkReissueStudentAccountsDto,
  ChangePasswordDto,
  CreateUserDto,
  DeactivateStudentAccountDto,
  GenerateStudentAccountsDto,
  StudentAccountBulkFilterDto,
  StudentAccountListQueryDto,
  UpdateOwnProfileDto,
  UpdateUserDto,
} from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import {
  UsersRepository,
  type StudentAccountManagementFilters,
  type UserListFilters,
} from './users.repository';
import type {
  ActorContext,
  DataScope,
  QueryExecutor,
  StudentAccountCandidateRow,
  StudentAccountManagementRow,
} from './users.types';

interface LifecycleAuditMeta {
  ip?: string | null;
  action: AuditAction;
}

// Shared with StudentAccountBatchService so the async batch path can't drift
// from the synchronous generate/reissue path (same TTL, alphabet, role, perms).
export const STUDENT_ACCOUNT_PERMISSIONS = ['home', 'student-self'] as const;
export const STUDENT_ACCOUNT_ROLE = 'STUDENT';
const SUPER_ADMIN_ROLE = 'ADMIN';
const STUDENT_ACCOUNT_BATCH_LIMIT = 200;
export const TEMP_PASSWORD_TTL_DAYS = 7;
export const USERNAME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HARD_DELETE_PERMISSION = 'manage-users-hard-delete';

function cleanNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
    private readonly passwordService: PasswordService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getAllUsers(actor?: ActorContext, filters: Partial<UserListFilters> = {}) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: currentActor.roles,
    });
    const actorRank = this.usersPolicyService.getRoleRank(actorRole, roleMap);
    const page = resolvePage(filters.page);
    const limit = resolveLimit(filters.limit);
    const { rows, totalCount, lifecycleStatusCounts } =
      await this.usersRepository.listUsersPaginated({
        actorId: currentActor.id,
        actorRole,
        actorRank,
        actorScope: currentActor.data_scope,
        excludeRole: filters.excludeRole,
        searchTerm: filters.searchTerm,
        province: filters.province,
        district: filters.district,
        subDistrict: filters.subDistrict,
        schoolId: filters.schoolId,
        gradeLevelId: filters.gradeLevelId,
        room: filters.room,
        page,
        limit,
      });
    const users = rows.map((row) => this.usersPolicyService.hydrateUserPermissions(row, roleMap));

    return {
      success: true,
      data: users,
      meta: {
        ...buildPaginationMeta(page, limit, totalCount),
        lifecycleStatusCounts,
      },
    };
  }

  async getUserById(id: number, actor?: ActorContext) {
    const roleMap = await this.usersPolicyService.getRoleMap();
    const row = await this.usersRepository.findUserById(id);
    if (!row) {
      return null;
    }

    const user = this.usersPolicyService.hydrateUserPermissions(row, roleMap);
    if (actor && !this.usersPolicyService.canManageUser(actor, user, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลผู้ใช้งานนี้');
    }

    const studentUuid = user.roles?.includes('STUDENT')
      ? await this.usersRepository.findCurrentStudentUuidByUserId(user.id)
      : null;
    return studentUuid ? { ...user, student_uuid: studentUuid } : user;
  }

  async getOwnProfile(actor: ActorContext | undefined) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const row = await this.usersRepository.findOwnProfileById(currentActor.id);
    if (!row) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }
    const user = this.usersPolicyService.hydrateUserPermissions(row, roleMap);
    const studentUuid = user.roles?.includes('STUDENT')
      ? await this.usersRepository.findCurrentStudentUuidByUserId(user.id)
      : null;
    return studentUuid ? { ...user, student_uuid: studentUuid } : user;
  }

  async updateOwnProfile(actor: ActorContext | undefined, data: UpdateOwnProfileDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const existingRow = await this.usersRepository.findOwnProfileById(currentActor.id);

    if (!existingRow) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);
    const firstName =
      data.FirstName !== undefined ? cleanNullableText(data.FirstName) : existingUser.FirstName;
    const lastName =
      data.LastName !== undefined ? cleanNullableText(data.LastName) : existingUser.LastName;
    const addressLatitude =
      data.address_latitude !== undefined
        ? data.address_latitude
        : (existingUser.address_latitude ?? null);
    const addressLongitude =
      data.address_longitude !== undefined
        ? data.address_longitude
        : (existingUser.address_longitude ?? null);

    if (!firstName || !lastName) {
      throw new BadRequestException('กรุณาระบุชื่อและนามสกุล');
    }
    if ((addressLatitude === null) !== (addressLongitude === null)) {
      throw new BadRequestException('กรุณาระบุ latitude และ longitude ให้ครบทั้งคู่');
    }

    await this.usersRepository.updateOwnProfile({
      id: currentActor.id,
      firstName,
      lastName,
      phone:
        data.phone !== undefined ? cleanNullableText(data.phone) : (existingUser.phone ?? null),
      email:
        data.email !== undefined ? cleanNullableText(data.email) : (existingUser.email ?? null),
      affiliation:
        data.affiliation !== undefined
          ? cleanNullableText(data.affiliation)
          : (existingUser.affiliation ?? null),
      lineId:
        data.line_id !== undefined
          ? cleanNullableText(data.line_id)
          : (existingUser.line_id ?? null),
      addressLine:
        data.address_line !== undefined
          ? cleanNullableText(data.address_line)
          : (existingUser.address_line ?? null),
      addressSubDistrict:
        data.address_sub_district !== undefined
          ? cleanNullableText(data.address_sub_district)
          : (existingUser.address_sub_district ?? null),
      addressDistrict:
        data.address_district !== undefined
          ? cleanNullableText(data.address_district)
          : (existingUser.address_district ?? null),
      addressProvince:
        data.address_province !== undefined
          ? cleanNullableText(data.address_province)
          : (existingUser.address_province ?? null),
      addressPostalCode:
        data.address_postal_code !== undefined
          ? cleanNullableText(data.address_postal_code)
          : (existingUser.address_postal_code ?? null),
      addressLatitude,
      addressLongitude,
      updatedBy: resolveAuditActorId(currentActor),
    });

    return await this.getOwnProfile(currentActor);
  }

  async createUser(actor: ActorContext | undefined, data: CreateUserDto) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      await this.usersPolicyService.assertAssignablePayload(
        currentActor,
        data,
        { allowEqualRole: false },
        roleMap,
      );

      const password = data.password || this.passwordService.generateTempPassword();
      const generatedTempPassword = data.password ? undefined : password;

      // New accounts start in "awaiting first login" with a temporary password:
      // they must change it within the window before it expires (login is then
      // blocked until an admin reissues). Same lifecycle/TTL as bulk-generate.
      const temporaryPasswordIssuedAt = new Date();
      const temporaryPasswordExpiresAt = new Date(
        temporaryPasswordIssuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000,
      );

      const userId = await this.usersRepository.withTransaction(async (executor) => {
        const passwordHash = await this.passwordService.hash(password);
        const primaryRole = this.usersPolicyService.normalizeRole(data);

        return await this.usersRepository.createUser(
          {
            username: data.username,
            passwordHash,
            firstName: data.FirstName,
            lastName: data.LastName,
            personIdOnec: data.PersonID_Onec,
            personUuid: null,
            phone: data.phone || null,
            email: data.email || null,
            affiliation: data.affiliation || null,
            status: data.status || 'ACTIVE',
            permissions: data.permissions || [],
            role: primaryRole,
            dataScope: data.data_scope || {},
            mustChangePassword: true,
            temporaryPasswordIssuedAt,
            temporaryPasswordExpiresAt,
            createdBy: resolveAuditActorId(currentActor),
          },
          executor,
        );
      });

      return {
        success: true,
        userId,
        tempPassword: generatedTempPassword || undefined,
        must_change_password: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`createUser error: ${message}`);
      throw err;
    }
  }

  async updateUser(actor: ActorContext | undefined, id: number, data: UpdateUserDto) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      const existingRow = await this.usersRepository.findUserById(id);

      if (!existingRow) {
        throw new NotFoundException('ไม่พบผู้ใช้งาน');
      }

      const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);

      if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
        throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขผู้ใช้งานนี้');
      }

      if (data.status !== undefined && data.status !== existingUser.status) {
        throw new BadRequestException(
          'กรุณาใช้คำสั่งปิดหรือเปิดใช้งานบัญชีเพื่อเปลี่ยนสถานะผู้ใช้',
        );
      }

      const isSelf = currentActor.id === id;
      const existingRole = this.usersPolicyService.getPrimaryRole(existingUser);
      const requestedRole = this.usersPolicyService.normalizeRole(data);

      if (isSelf && requestedRole !== existingRole) {
        throw new ForbiddenException('ไม่สามารถเปลี่ยนตำแหน่งของบัญชีตัวเองได้');
      }

      await this.usersPolicyService.assertAssignablePayload(
        currentActor,
        data,
        { allowEqualRole: isSelf },
        roleMap,
      );

      await this.usersRepository.withTransaction(async (executor) => {
        const primaryRole = this.usersPolicyService.normalizeRole(data);
        const passwordHash = data.password
          ? await this.passwordService.hash(data.password)
          : undefined;

        await this.usersRepository.updateUser(
          {
            id,
            username: data.username ?? existingUser.username,
            passwordHash,
            firstName: data.FirstName ?? existingUser.FirstName ?? '',
            lastName: data.LastName ?? existingUser.LastName ?? '',
            personIdOnec: data.PersonID_Onec ?? existingUser.PersonID_Onec ?? '',
            phone: data.phone ?? existingUser.phone ?? null,
            email: data.email ?? existingUser.email ?? null,
            affiliation: data.affiliation ?? existingUser.affiliation ?? null,
            status: data.status ?? existingUser.status ?? 'ACTIVE',
            permissions:
              data.permissions ??
              this.usersPolicyService.normalizePermissionList(existingUser.permissions),
            role: primaryRole,
            dataScope: data.data_scope ?? existingUser.data_scope ?? {},
            updatedBy: resolveAuditActorId(currentActor),
          },
          executor,
        );
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`updateUser error: ${message}`);
      throw err;
    }
  }

  async deleteUser(actor: ActorContext | undefined, id: number) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      const existingRow = await this.usersRepository.findUserById(id);

      if (!existingRow) {
        throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งานที่ต้องการลบ');
      }

      const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);

      if (currentActor.id === id) {
        throw new ForbiddenException('ไม่สามารถลบบัญชีของตัวเองได้');
      }

      if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
        throw new ForbiddenException('ไม่มีสิทธิ์ลบผู้ใช้งานนี้');
      }

      if (!hasPermission(currentActor.roles, currentActor.permissions, HARD_DELETE_PERMISSION)) {
        throw new ForbiddenException('ไม่มีสิทธิ์ลบบัญชีผู้ใช้ถาวร');
      }

      if (existingUser.status === 'ACTIVE') {
        throw new ConflictException('ต้องปิดใช้งานบัญชีก่อนลบถาวร');
      }

      const rowCount = await this.usersRepository.withTransaction(async (executor) => {
        const references = await this.usersRepository.listUserOperationalReferences(id, executor);
        if (references.length > 0) {
          const sample = references.slice(0, 5).join(', ');
          throw new ConflictException(
            `ไม่สามารถลบบัญชีถาวรได้เนื่องจากยังมีประวัติการใช้งาน: ${sample}`,
          );
        }

        return await this.usersRepository.deleteUser(id, executor);
      });

      if (rowCount === 0) {
        throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งานที่ต้องการลบ');
      }

      return { success: true, rowCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`deleteUser error: ${message}`);
      throw err;
    }
  }

  async deactivateAccount(
    actor: ActorContext | undefined,
    userId: number,
    data: DeactivateStudentAccountDto,
    auditMeta: LifecycleAuditMeta,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const existingRow = await this.usersRepository.findUserById(userId);
    if (!existingRow) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);
    if (currentActor.id === userId) {
      throw new ForbiddenException('ไม่สามารถปิดใช้งานบัญชีของตัวเองได้');
    }
    if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ปิดใช้งานผู้ใช้งานนี้');
    }
    if (existingUser.status !== 'ACTIVE') {
      throw new ConflictException('บัญชีนี้ถูกปิดการใช้งานแล้ว');
    }

    const reason = this.normalizeDeactivationReason(data);
    await this.usersRepository.withTransaction(async (executor) => {
      if (existingUser.role === SUPER_ADMIN_ROLE) {
        const activeAdmins = await this.usersRepository.countActiveUsersByRole(
          SUPER_ADMIN_ROLE,
          executor,
          { lockRows: true },
        );
        if (activeAdmins <= 1) {
          throw new ConflictException('ไม่สามารถปิดใช้งานผู้ดูแลระบบคนสุดท้ายได้');
        }
      }

      const updated = await this.usersRepository.deactivateUser(
        {
          id: userId,
          actorId: resolveAuditActorId(currentActor),
          reasonCode: reason.reasonCode,
          note: reason.note,
        },
        executor,
      );
      if (!updated) {
        throw new ConflictException('ไม่สามารถปิดใช้งานบัญชีนี้ได้');
      }
      await this.auditLog.recordAtomic(
        {
          action: auditMeta.action,
          actorUserId: resolveAuditActorId(currentActor),
          actorLabel: currentActor.username,
          targetType: 'user',
          targetId: String(userId),
          metadata: {
            username: existingUser.username,
            reasonCode: reason.reasonCode,
            note: reason.note,
            reason: reason.note,
          },
          ip: auditMeta.ip ?? null,
        },
        executor,
      );
    });

    return {
      success: true,
      userId,
      status: 'DISABLED',
      reasonCode: reason.reasonCode,
      note: reason.note,
      reason: reason.note,
    };
  }

  async reactivateAccount(
    actor: ActorContext | undefined,
    userId: number,
    auditMeta: LifecycleAuditMeta,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const existingRow = await this.usersRepository.findUserById(userId);
    if (!existingRow) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);
    if (currentActor.id === userId) {
      throw new ForbiddenException('ไม่สามารถเปิดใช้งานบัญชีของตัวเองได้');
    }
    if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เปิดใช้งานผู้ใช้งานนี้');
    }
    if (existingUser.status === 'ACTIVE') {
      throw new ConflictException('บัญชีนี้เปิดใช้งานอยู่แล้ว');
    }

    await this.usersRepository.withTransaction(async (executor) => {
      const updated = await this.usersRepository.reactivateUser(userId, executor);
      if (!updated) {
        throw new ConflictException('ไม่สามารถเปิดใช้งานบัญชีนี้ได้');
      }
      await this.auditLog.recordAtomic(
        {
          action: auditMeta.action,
          actorUserId: resolveAuditActorId(currentActor),
          actorLabel: currentActor.username,
          targetType: 'user',
          targetId: String(userId),
          metadata: { username: existingUser.username },
          ip: auditMeta.ip ?? null,
        },
        executor,
      );
    });

    return {
      success: true,
      userId,
      status: 'ACTIVE',
      needsReissue: this.needsTemporaryPasswordReissue(existingUser),
    };
  }

  async changeOwnPassword(actor: ActorContext | undefined, data: ChangePasswordDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const user = await this.usersRepository.findUserById(currentActor.id);

    if (!user) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const authUser = await this.usersRepository.findUserByUsername(user.username);
    if (!authUser?.password) {
      throw new NotFoundException('ไม่พบข้อมูลรหัสผ่าน');
    }

    const isCurrentPasswordValid = await this.passwordService.compare(
      data.currentPassword,
      authUser.password,
    );

    if (!isCurrentPasswordValid) {
      throw new ForbiddenException('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    const passwordHash = await this.passwordService.hash(data.newPassword);
    await this.usersRepository.updatePasswordAndClearMustChange(currentActor.id, passwordHash);

    return { success: true, must_change_password: false };
  }

  async reissueStudentTemporaryPassword(actor: ActorContext | undefined, userId: number) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const row = await this.usersRepository.findStudentAccountForManagement(
      userId,
      currentActor.data_scope,
    );
    if (!row) {
      throw new NotFoundException('ไม่พบบัญชีนักเรียน');
    }
    if (row.status !== 'ACTIVE') {
      throw new ConflictException('บัญชีนักเรียนนี้ถูกปิดการใช้งาน');
    }

    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000);
    const updated = await this.usersRepository.reissueTemporaryPassword(
      userId,
      passwordHash,
      issuedAt,
      expiresAt,
    );
    if (!updated) {
      throw new ConflictException('ไม่สามารถออกรหัสชั่วคราวใหม่ให้บัญชีนี้ได้');
    }

    return {
      success: true,
      userId,
      username: row.username,
      tempPassword,
      temporaryPasswordIssuedAt: issuedAt.toISOString(),
      temporaryPasswordExpiresAt: expiresAt.toISOString(),
    };
  }

  // General reissue for any role the actor may manage (Manage Users page),
  // guarded by the same role-hierarchy/scope check as edit/delete — unlike
  // reissueStudentTemporaryPassword which is scoped to student-account management.
  async reissueTemporaryPassword(actor: ActorContext | undefined, userId: number) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const existingRow = await this.usersRepository.findUserById(userId);
    if (!existingRow) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);
    if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ออกรหัสชั่วคราวใหม่ให้ผู้ใช้งานนี้');
    }
    if (existingUser.status !== 'ACTIVE') {
      throw new ConflictException('บัญชีนี้ถูกปิดการใช้งาน');
    }

    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000);
    const updated = await this.usersRepository.reissueTemporaryPassword(
      userId,
      passwordHash,
      issuedAt,
      expiresAt,
    );
    if (!updated) {
      throw new ConflictException('ไม่สามารถออกรหัสชั่วคราวใหม่ให้บัญชีนี้ได้');
    }

    return {
      success: true,
      userId,
      username: existingUser.username,
      tempPassword,
      temporaryPasswordIssuedAt: issuedAt.toISOString(),
      temporaryPasswordExpiresAt: expiresAt.toISOString(),
    };
  }

  async listStudentAccounts(actor: ActorContext | undefined, filters: StudentAccountListQueryDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const normalizedFilters = this.normalizeStudentAccountManagementFilters(
      filters,
      currentActor.data_scope,
    );
    const [{ rows, totalCount }, statusCounts] = await Promise.all([
      this.usersRepository.listStudentAccountsPaginated(normalizedFilters),
      this.usersRepository.countStudentAccountStatuses(normalizedFilters),
    ]);

    return {
      success: true,
      data: rows.map((row) => this.toStudentAccountManagementResponse(row)),
      meta: {
        ...buildPaginationMeta(
          normalizedFilters.page ?? 1,
          normalizedFilters.limit ?? 20,
          totalCount,
        ),
        statusCounts,
      },
    };
  }

  async bulkReissueStudentTemporaryPasswords(
    actor: ActorContext | undefined,
    filters: BulkReissueStudentAccountsDto,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const userIds = Array.isArray(filters.userIds)
      ? Array.from(new Set(filters.userIds.filter((id) => Number.isInteger(id) && id > 0)))
      : [];
    const normalizedFilters = this.normalizeStudentAccountManagementFilters(
      {
        ...filters,
        userIds,
        page: userIds.length > 0 ? 1 : filters.page,
        onlyExpired: userIds.length > 0 ? filters.onlyExpired : true,
        limit: Math.min(filters.limit ?? STUDENT_ACCOUNT_BATCH_LIMIT, STUDENT_ACCOUNT_BATCH_LIMIT),
      },
      currentActor.data_scope,
    );
    const { rows } = await this.usersRepository.listStudentAccountsPaginated(normalizedFilters);
    if (rows.length === 0) {
      throw new ConflictException('ไม่มีบัญชีนักเรียนที่ต้องออกรหัสใหม่');
    }

    const credentials: Array<{
      userId: number;
      username: string;
      tempPassword: string;
      studentName: string;
      schoolName: string | null;
      grade: string | null;
      room: number | null;
      temporaryPasswordIssuedAt: string;
      temporaryPasswordExpiresAt: string;
    }> = [];
    const skipped: Array<{ userId: number; reason: string }> = [];
    for (const row of rows) {
      if (row.status !== 'ACTIVE') {
        skipped.push({ userId: row.user_id, reason: 'บัญชีถูกปิดการใช้งาน' });
        continue;
      }
      const tempPassword = this.passwordService.generateTempPassword();
      const passwordHash = await this.passwordService.hash(tempPassword);
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000);
      const updated = await this.usersRepository.reissueTemporaryPassword(
        row.user_id,
        passwordHash,
        issuedAt,
        expiresAt,
      );
      if (!updated) {
        skipped.push({ userId: row.user_id, reason: 'ไม่สามารถออกรหัสใหม่ได้' });
        continue;
      }
      credentials.push({
        userId: row.user_id,
        username: row.username,
        tempPassword,
        studentName: this.getStudentAccountManagementName(row),
        schoolName: row.school_name,
        grade: row.grade_label,
        room: row.room_id,
        temporaryPasswordIssuedAt: issuedAt.toISOString(),
        temporaryPasswordExpiresAt: expiresAt.toISOString(),
      });
    }

    if (credentials.length === 0) {
      throw new ConflictException('ไม่สามารถออกรหัสใหม่ให้บัญชีนักเรียนในรายการนี้ได้');
    }

    return {
      success: true,
      requestedCount: rows.length,
      reissuedCount: credentials.length,
      skippedCount: skipped.length,
      credentials,
      skipped,
    };
  }

  async deactivateStudentAccount(
    actor: ActorContext | undefined,
    userId: number,
    data: DeactivateStudentAccountDto,
    auditMeta: Omit<LifecycleAuditMeta, 'action'> = {},
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const row = await this.usersRepository.findStudentAccountForManagement(
      userId,
      currentActor.data_scope,
    );
    if (!row) {
      throw new NotFoundException('ไม่พบบัญชีนักเรียน');
    }
    if (row.status !== 'ACTIVE') {
      throw new ConflictException('บัญชีนักเรียนนี้ถูกปิดการใช้งานแล้ว');
    }
    return await this.deactivateAccount(actor, userId, data, {
      action: 'STUDENT_ACCOUNT_DEACTIVATE',
      ip: auditMeta.ip ?? null,
    });
  }

  async reactivateStudentAccount(
    actor: ActorContext | undefined,
    userId: number,
    auditMeta: Omit<LifecycleAuditMeta, 'action'> = {},
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const row = await this.usersRepository.findStudentAccountForManagement(
      userId,
      currentActor.data_scope,
    );
    if (!row) {
      throw new NotFoundException('ไม่พบบัญชีนักเรียน');
    }
    if (row.status === 'ACTIVE') {
      throw new ConflictException('บัญชีนักเรียนนี้เปิดใช้งานอยู่แล้ว');
    }
    return await this.reactivateAccount(actor, userId, {
      action: 'STUDENT_ACCOUNT_REACTIVATE',
      ip: auditMeta.ip ?? null,
    });
  }

  async previewStudentAccounts(
    actor: ActorContext | undefined,
    filters: StudentAccountBulkFilterDto,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const normalizedFilters = this.normalizeStudentAccountFilters(filters, currentActor.data_scope);
    const [summary, candidates] = await Promise.all([
      this.usersRepository.countStudentAccountCandidates(normalizedFilters),
      this.usersRepository.listStudentAccountCandidates(normalizedFilters),
    ]);

    return {
      success: true,
      data: {
        summary,
        candidates: candidates.map((candidate) =>
          this.toStudentAccountCandidateResponse(candidate),
        ),
        limit: normalizedFilters.limit,
        meta: buildPaginationMeta(
          normalizedFilters.page,
          normalizedFilters.limit,
          summary.withoutAccountCount,
        ),
      },
    };
  }

  async generateStudentAccounts(
    actor: ActorContext | undefined,
    filters: GenerateStudentAccountsDto,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const normalizedFilters = this.normalizeStudentAccountFilters(
      {
        ...filters,
        onlyWithoutAccount: true,
      },
      currentActor.data_scope,
    );
    const actorId = resolveAuditActorId(currentActor);
    const credentials = await this.usersRepository.withTransaction(async (executor) => {
      const candidates = await this.usersRepository.listStudentAccountCandidates(
        normalizedFilters,
        executor,
      );
      const created: Array<{
        userId: number;
        username: string;
        tempPassword: string;
        studentName: string;
        schoolName: string | null;
        grade: string | null;
        room: number | null;
        temporaryPasswordIssuedAt: string;
        temporaryPasswordExpiresAt: string;
      }> = [];

      for (const candidate of candidates) {
        const username = await this.generateUniqueStudentUsername(candidate.school_id, executor);
        const tempPassword = this.passwordService.generateTempPassword();
        const passwordHash = await this.passwordService.hash(tempPassword);
        const temporaryPasswordIssuedAt = new Date();
        const temporaryPasswordExpiresAt = new Date(
          temporaryPasswordIssuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000,
        );
        try {
          const userId = await this.usersRepository.createUser(
            {
              username,
              passwordHash,
              firstName: candidate.first_name || '-',
              lastName: candidate.last_name || '-',
              personIdOnec: '',
              personUuid: candidate.person_uuid,
              phone: null,
              email: null,
              affiliation: candidate.school_name || null,
              status: 'ACTIVE',
              permissions: [...STUDENT_ACCOUNT_PERMISSIONS],
              role: STUDENT_ACCOUNT_ROLE,
              dataScope: { own_only: true },
              mustChangePassword: true,
              temporaryPasswordIssuedAt,
              temporaryPasswordExpiresAt,
              createdBy: actorId,
            },
            executor,
          );
          created.push({
            userId,
            username,
            tempPassword,
            studentName: this.getStudentDisplayName(candidate),
            schoolName: candidate.school_name,
            grade: candidate.grade_label,
            room: candidate.room_id,
            temporaryPasswordIssuedAt: temporaryPasswordIssuedAt.toISOString(),
            temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
          });
        } catch (error) {
          if (!this.isUniqueViolation(error)) {
            throw error;
          }
          this.logger.warn('Skipped duplicate student account during bulk generate');
        }
      }
      return created;
    });

    if (credentials.length === 0) {
      throw new ConflictException('ไม่มีนักเรียนที่ต้องสร้างบัญชี');
    }

    this.logger.log(`Generated ${credentials.length} student accounts by actor ${currentActor.id}`);

    return {
      success: true,
      createdCount: credentials.length,
      credentials,
    };
  }

  async getRoles(actor?: ActorContext) {
    const definitions = await this.usersPolicyService.getRoleDefinitions();
    if (!actor) {
      return definitions;
    }

    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: actor.roles,
    });

    return definitions.filter(
      (role) =>
        role.name === actorRole ||
        (this.usersPolicyService.canManageRole(actorRole, role.name, roleMap) &&
          this.usersPolicyService.canGrantPermissions(
            actor.permissions || [],
            role.default_permissions || [],
            actorRole,
            roleMap,
          )),
    );
  }

  private assertCanManageStudentAccounts(actor: ActorContext): void {
    const permissions = new Set(actor.permissions || []);
    if (
      permissions.has('manage-student-accounts') ||
      permissions.has('*') ||
      permissions.has('ALL')
    ) {
      return;
    }
    throw new ForbiddenException('ไม่มีสิทธิ์สร้างบัญชีนักเรียน');
  }

  private normalizeStudentAccountFilters(
    filters: StudentAccountBulkFilterDto,
    actorScope: DataScope | undefined,
  ) {
    if (actorScope?.own_only) {
      throw new ForbiddenException('บัญชีส่วนตัวไม่สามารถสร้างบัญชีนักเรียนได้');
    }
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), STUDENT_ACCOUNT_BATCH_LIMIT);
    const page = Math.max(filters.page ?? 1, 1);
    const cleanString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;
    const grade = cleanString(filters.grade);
    return {
      actorScope,
      schoolId: filters.schoolId,
      province: cleanString(filters.province),
      district: cleanString(filters.district),
      subDistrict: cleanString(filters.subDistrict),
      grade,
      room: filters.room,
      onlyWithoutAccount: filters.onlyWithoutAccount !== false,
      page,
      limit,
    };
  }

  private normalizeStudentAccountManagementFilters(
    filters: StudentAccountListQueryDto & { userIds?: number[] },
    actorScope: DataScope | undefined,
  ): StudentAccountManagementFilters {
    if (actorScope?.own_only) {
      throw new ForbiddenException('บัญชีส่วนตัวไม่สามารถจัดการบัญชีนักเรียนได้');
    }
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), STUDENT_ACCOUNT_BATCH_LIMIT);
    const page = Math.max(filters.page ?? 1, 1);
    const cleanString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;
    return {
      actorScope,
      userIds: filters.userIds,
      searchTerm: cleanString(filters.searchTerm),
      schoolId: filters.schoolId,
      province: cleanString(filters.province),
      district: cleanString(filters.district),
      subDistrict: cleanString(filters.subDistrict),
      grade: cleanString(filters.grade),
      room: filters.room,
      accountStatus: filters.accountStatus,
      onlyExpired: filters.onlyExpired === true,
      page,
      limit,
    };
  }

  private async generateUniqueStudentUsername(
    schoolId: number,
    executor: QueryExecutor,
  ): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = Array.from(
        { length: 5 },
        () => USERNAME_ALPHABET[randomInt(0, USERNAME_ALPHABET.length)],
      ).join('');
      const username = `${schoolId}-${suffix}`;
      if (!(await this.usersRepository.usernameExists(username, executor))) {
        return username;
      }
    }
    throw new BadRequestException('ไม่สามารถสุ่ม username ที่ไม่ซ้ำได้ กรุณาลองใหม่');
  }

  private getStudentDisplayName(candidate: StudentAccountCandidateRow): string {
    return [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || '-';
  }

  private getStudentAccountManagementName(row: StudentAccountManagementRow): string {
    return [row.first_name, row.last_name].filter(Boolean).join(' ') || '-';
  }

  private getStudentAccountStatus(
    row: StudentAccountManagementRow,
  ): 'PENDING_FIRST_LOGIN' | 'ACTIVE' | 'TEMP_PASSWORD_EXPIRED' | 'DISABLED' {
    if (row.status !== 'ACTIVE') {
      return 'DISABLED';
    }
    if (row.must_change_password === true) {
      const expiresAt = row.temporary_password_expires_at
        ? new Date(row.temporary_password_expires_at)
        : null;
      if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
        return 'TEMP_PASSWORD_EXPIRED';
      }
      return 'PENDING_FIRST_LOGIN';
    }
    return 'ACTIVE';
  }

  private normalizeDeactivationReason(data: DeactivateStudentAccountDto): {
    reasonCode: AccountDeactivationReasonCode;
    note: string | null;
  } {
    const note = (data.note ?? data.reason)?.trim() || null;
    return {
      reasonCode: data.reasonCode ?? 'OTHER',
      note,
    };
  }

  private needsTemporaryPasswordReissue(user: {
    must_change_password?: boolean | null;
    temporary_password_expires_at?: string | Date | null;
  }): boolean {
    if (user.must_change_password !== true || !user.temporary_password_expires_at) {
      return false;
    }
    const expiresAt = new Date(user.temporary_password_expires_at);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now();
  }

  private toIsoString(value: string | Date | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  private toStudentAccountManagementResponse(row: StudentAccountManagementRow) {
    const expiresAt = row.temporary_password_expires_at
      ? new Date(row.temporary_password_expires_at)
      : null;
    const remainingSeconds =
      expiresAt && !Number.isNaN(expiresAt.getTime())
        ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
        : null;
    return {
      userId: row.user_id,
      username: row.username,
      studentName: this.getStudentAccountManagementName(row),
      schoolId: row.school_id,
      schoolName: row.school_name,
      grade: row.grade_label,
      gradeLevelId: row.grade_level_id,
      room: row.room_id,
      academicYear: row.academic_year,
      semester: row.semester,
      status: this.getStudentAccountStatus(row),
      accountStatus: row.status || null,
      mustChangePassword: row.must_change_password === true,
      temporaryPasswordIssuedAt: this.toIsoString(row.temporary_password_issued_at),
      temporaryPasswordExpiresAt: this.toIsoString(row.temporary_password_expires_at),
      temporaryPasswordRemainingSeconds: remainingSeconds,
      deactivatedAt: this.toIsoString(row.deactivated_at),
      deactivatedBy: row.deactivated_by ?? null,
      deactivationReasonCode: row.deactivation_reason_code ?? null,
      deactivationNote: row.deactivation_note ?? null,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private toStudentAccountCandidateResponse(candidate: StudentAccountCandidateRow) {
    return {
      studentId: candidate.student_uuid,
      studentName: this.getStudentDisplayName(candidate),
      schoolId: candidate.school_id,
      schoolName: candidate.school_name,
      grade: candidate.grade_label,
      room: candidate.room_id,
      academicYear: candidate.academic_year,
      semester: candidate.semester,
      hasActiveAccount: candidate.existing_user_id !== null,
      username: candidate.existing_username,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }
}

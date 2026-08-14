import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { processImageUpload } from '../common/file-upload/visit-photo.util';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import { buildSubjectStudentRef } from '../common/utils/pii-ref.util';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import { piiConfig } from '../config/pii.config';
import {
  PII_REASON_CODES,
  PII_REASON_REQUIRES_NOTE,
  maskNationalIdValue,
  normalizeNationalIdValue,
  type PiiReasonCode,
} from '../students/pii-fields.config';
import type { UserAddressRevealDto } from './dto/user-address-reveal.dto';
import { AuditLogService, type AuditAction } from '../audit-log/audit-log.service';
import { finalizePersistedDataScope } from '../auth/auth.types';
import { hasPermission } from '../auth/permissions.constants';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { PasswordService } from '../auth/password.service';
import type {
  AccountDeactivationReasonCode,
  ChangePasswordDto,
  CreateUserDto,
  DeactivateUserAccountDto,
  UpdateOwnProfileDto,
  UpdateUserDto,
} from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository, type UserListFilters } from './users.repository';
import type { ActorContext, DataScope, QueryExecutor } from './users.types';

interface LifecycleAuditMeta {
  ip?: string | null;
  action: AuditAction;
  metadata?: Record<string, unknown>;
}

const SUPER_ADMIN_ROLE = 'ADMIN';
export const TEMP_PASSWORD_TTL_DAYS = 7;
const HARD_DELETE_PERMISSION = 'manage-users-hard-delete';
const USERNAME_ALREADY_USED_MESSAGE = 'ชื่อผู้ใช้งานนี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น';

function cleanNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function cleanPrefixedAddressText(prefix: string, value: unknown): string | null {
  const text = cleanNullableText(value);
  if (!text) {
    return null;
  }
  const normalized = text.replace(new RegExp(`^\\s*${prefix}\\s*`, 'u'), '').trim();
  return normalized || null;
}

function normalizeNumericScopeValues(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)),
  );
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
    private readonly passwordService: PasswordService,
    private readonly auditLog: AuditLogService,
    @Inject(piiConfig.KEY)
    private readonly piiRuntimeConfig: ConfigType<typeof piiConfig>,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
  ) {}

  /**
   * Profile photo read for จัดการผู้ใช้งาน. The scope check runs through the same
   * `getUserById` path as the rest of the record, so a caller can never fetch a
   * photo for an account outside their scope.
   */
  async resolveUserPhoto(id: number, actor: ActorContext | undefined): Promise<FileServeResult> {
    const user = await this.usersRepository.findUserById(id);
    if (!user?.photo_storage_key) {
      throw new NotFoundException('ไม่พบรูปประจำตัวผู้ใช้งาน');
    }
    if (!(await this.getUserById(id, actor))) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }
    const result = await this.storage.resolve(user.photo_storage_key);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวผู้ใช้งาน');
    return result;
  }

  /**
   * Replaces or clears the profile photo. The upload is processed before the
   * write and removed again if the write fails, so storage never keeps an
   * orphan; the replaced object is deleted only once the row points at the new
   * one.
   */
  async updateUserPhoto(
    id: number,
    actor: ActorContext | undefined,
    file?: Express.Multer.File,
    removePhoto?: boolean,
  ) {
    if (file && removePhoto) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำรูปออกพร้อมกันได้');
    }
    if (!file && !removePhoto) {
      throw new BadRequestException('กรุณาเลือกรูปหรือระบุการนำรูปออก');
    }
    const existing = await this.getUserById(id, actor);
    if (!existing) throw new NotFoundException('ไม่พบผู้ใช้งาน');

    const current = await this.usersRepository.findUserById(id);
    const replacedStorageKey = current?.photo_storage_key ?? null;
    const newStorageKey = file ? await processImageUpload(file, this.storage, 'user-photos') : null;

    try {
      await this.usersRepository.updateUserPhoto(id, newStorageKey);
    } catch (error) {
      if (newStorageKey) {
        await this.storage.delete(newStorageKey).catch(() => {
          this.logger.warn(`Unable to delete unused profile photo for user ${id}`);
        });
      }
      throw error;
    }

    try {
      await this.auditLog.record({
        actorUserId: resolveAuditActorId(actor),
        actorLabel: actor?.username ?? null,
        action: 'USER_UPDATE',
        targetType: 'users',
        targetId: String(id),
        metadata: { op: newStorageKey ? 'update-photo' : 'remove-photo' },
        ip: null,
      });
    } catch (error) {
      // The database already points to the new object. Deleting it here would
      // leave a broken profile photo; surface the audit outage in logs instead.
      this.logger.error(
        `Unable to audit profile photo update for user ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (replacedStorageKey) {
      await this.storage.delete(replacedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete replaced profile photo for user ${id}`);
      });
    }
    return await this.getUserById(id, actor);
  }

  private resolveTeacherSchoolIds(role: string, scope: DataScope): number[] {
    if (role !== 'TEACHER') {
      return [];
    }
    const schoolIds = normalizeNumericScopeValues(scope.school_ids);
    if (schoolIds.length === 0) {
      throw new BadRequestException('กรุณาเลือกโรงเรียนสังกัดสำหรับบัญชีครู');
    }
    return schoolIds;
  }

  private async reconcileTeacherMemberships(
    userId: number,
    schoolIds: number[],
    actor: ActorContext,
    executor: QueryExecutor,
  ): Promise<void> {
    if (schoolIds.length > 0) {
      const schools = await this.usersRepository.findSchoolNamesByIds(schoolIds, executor);
      if (schools.length !== schoolIds.length) {
        throw new BadRequestException('โรงเรียนสังกัดของบัญชีครูไม่ถูกต้อง');
      }
    }
    const result = await this.usersRepository.reconcileTeacherMemberships(
      {
        teacherUserId: userId,
        schoolIds,
        actorUserId: resolveAuditActorId(actor),
      },
      executor,
    );
    if (result.activatedSchoolIds.length === 0 && result.endedSchoolIds.length === 0) {
      return;
    }
    await this.auditLog.recordAtomic(
      {
        actorUserId: resolveAuditActorId(actor),
        actorLabel: actor.username,
        action: 'MASTER_DATA_EDIT',
        targetType: 'school_teacher_memberships',
        targetId: String(userId),
        metadata: {
          op: 'sync-from-user',
          activatedSchoolIds: result.activatedSchoolIds,
          endedSchoolIds: result.endedSchoolIds,
        },
        ip: null,
      },
      executor,
    );
  }

  async revealUserAddress(
    id: number,
    actor: ActorContext | undefined,
    data: UserAddressRevealDto,
    meta: { ip: string | null; userAgent: string | null; requestId: string | null },
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    await this.getUserById(id, currentActor);
    const profile = await this.usersRepository.findOwnProfileById(id);
    if (!profile) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const reasonCode = data.reason_code as PiiReasonCode;
    const reasonNote = data.reason_note?.trim() || null;
    if (!PII_REASON_CODES.includes(reasonCode) || reasonCode === 'SELF_ACCESS') {
      throw new BadRequestException('กรุณาระบุเหตุผลที่ถูกต้อง');
    }
    if (PII_REASON_REQUIRES_NOTE.includes(reasonCode) && !reasonNote) {
      throw new BadRequestException('กรุณาระบุรายละเอียดเหตุผล');
    }
    if (reasonNote && /\d(?:[\s-]*\d){9,}/u.test(reasonNote)) {
      throw new BadRequestException('รายละเอียดเหตุผลต้องไม่มีเลขเอกสารหรือข้อมูลระบุตัวบุคคล');
    }

    const subjectRef = buildSubjectStudentRef(
      `user-${id}`,
      this.piiRuntimeConfig.hashPepper,
      this.piiRuntimeConfig.hashKeyVersion,
    );
    const active = await this.usersRepository.hasActiveUserAddressReveal(
      currentActor.id,
      subjectRef,
      this.piiRuntimeConfig.revealTtlSeconds,
    );
    if (!active) {
      await this.usersRepository.insertUserAddressAccessEvent({
        actorUserId: currentActor.id,
        actorRoles: currentActor.roles ?? [],
        subjectRef,
        subjectRefKeyVersion: this.piiRuntimeConfig.hashKeyVersion,
        reasonCode,
        reasonNote,
        ...meta,
      });
    }

    return {
      address_line: profile.address_line ?? null,
      address_village_no: profile.address_village_no ?? null,
      address_street: profile.address_street ?? null,
      address_soi: profile.address_soi ?? null,
      address_trok: profile.address_trok ?? null,
      address_sub_district: profile.address_sub_district ?? null,
      address_district: profile.address_district ?? null,
      address_province: profile.address_province ?? null,
      address_postal_code: profile.address_postal_code ?? null,
      address_latitude: profile.address_latitude ?? null,
      address_longitude: profile.address_longitude ?? null,
    };
  }

  async revealUserNationalId(
    id: number,
    actor: ActorContext | undefined,
    data: UserAddressRevealDto,
    meta: { ip: string | null; userAgent: string | null; requestId: string | null },
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const authorizedUser = await this.getUserById(id, currentActor);
    const profile = await this.usersRepository.findOwnProfileById(id);
    if (!profile) throw new NotFoundException('ไม่พบผู้ใช้งาน');

    const reasonCode = data.reason_code as PiiReasonCode;
    const reasonNote = data.reason_note?.trim() || null;
    if (!PII_REASON_CODES.includes(reasonCode) || reasonCode === 'SELF_ACCESS') {
      throw new BadRequestException('กรุณาระบุเหตุผลที่ถูกต้อง');
    }
    if (PII_REASON_REQUIRES_NOTE.includes(reasonCode) && !reasonNote) {
      throw new BadRequestException('กรุณาระบุรายละเอียดเหตุผล');
    }
    if (reasonNote && /\d(?:[\s-]*\d){9,}/u.test(reasonNote)) {
      throw new BadRequestException('รายละเอียดเหตุผลต้องไม่มีเลขเอกสารหรือข้อมูลระบุตัวบุคคล');
    }

    const subjectRef = buildSubjectStudentRef(
      `user-${id}`,
      this.piiRuntimeConfig.hashPepper,
      this.piiRuntimeConfig.hashKeyVersion,
    );
    const active = await this.usersRepository.hasActiveUserNationalIdReveal(
      currentActor.id,
      subjectRef,
      this.piiRuntimeConfig.revealTtlSeconds,
    );
    if (!active) {
      await this.usersRepository.insertUserNationalIdAccessEvent({
        actorUserId: currentActor.id,
        actorRoles: currentActor.roles ?? [],
        subjectRef,
        subjectRefKeyVersion: this.piiRuntimeConfig.hashKeyVersion,
        reasonCode,
        reasonNote,
        ...meta,
      });
    }
    const resolvedNationalId =
      normalizeNationalIdValue(profile.PersonID_Onec) ||
      normalizeNationalIdValue(authorizedUser?.PersonID_Onec);
    return { PersonID_Onec: resolvedNationalId || null };
  }

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
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        searchTerm: filters.searchTerm,
        province: filters.province,
        district: filters.district,
        subDistrict: filters.subDistrict,
        schoolId: filters.schoolId,
        gradeLevelId: filters.gradeLevelId,
        room: filters.room,
        accountStatus: filters.accountStatus,
        page,
        limit,
      });
    const users = rows.map((row) => {
      const hydrated = this.usersPolicyService.hydrateUserPermissions(row, roleMap);
      const {
        photo_storage_key: photoStorageKey,
        role_default_permissions: _roleDefaultPermissions,
        ...user
      } = hydrated;
      void _roleDefaultPermissions;
      return {
        ...user,
        photo_url: photoStorageKey
          ? `/api/users/${user.id}/photo?v=${encodeMediaVersion(user.updated_at)}`
          : null,
      };
    });

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

    const isStudent = user.roles?.includes('STUDENT');
    const [studentUuid, resolvedNationalId] = isStudent
      ? await Promise.all([
          this.usersRepository.findCurrentStudentUuidByUserId(user.id),
          this.usersRepository.findResolvedNationalIdByUserId(user.id),
        ])
      : [null, user.PersonID_Onec ?? null];
    const {
      photo_storage_key: photoStorageKey,
      role_default_permissions: _roleDefaultPermissions,
      ...safeUser
    } = user;
    void _roleDefaultPermissions;
    const resolvedUser = {
      ...safeUser,
      photo_url: photoStorageKey
        ? `/api/users/${user.id}/photo?v=${encodeMediaVersion(user.updated_at)}`
        : null,
      PersonID_Onec: normalizeNationalIdValue(resolvedNationalId) || null,
    };
    return studentUuid ? { ...resolvedUser, student_uuid: studentUuid } : resolvedUser;
  }

  async getUserDetailById(id: number, actor?: ActorContext) {
    const user = await this.getUserById(id, actor);
    if (!user) {
      return null;
    }

    const studentUuid =
      'student_uuid' in user && typeof user.student_uuid === 'string' ? user.student_uuid : null;
    const [schoolLabels, gradeLevelLabels] = await Promise.all([
      this.usersRepository.findSchoolNamesByIds(
        normalizeNumericScopeValues(user.data_scope?.school_ids),
      ),
      this.usersRepository.findGradeLevelLabelsByIds(
        normalizeNumericScopeValues(user.data_scope?.grade_levels),
      ),
    ]);
    const profile = user;
    const hasProfileLocation = Boolean(
      profile?.address_line ||
      profile?.address_village_no ||
      profile?.address_street ||
      profile?.address_soi ||
      profile?.address_trok ||
      profile?.address_sub_district ||
      profile?.address_district ||
      profile?.address_province ||
      profile?.address_postal_code ||
      profile?.address_latitude != null ||
      profile?.address_longitude != null,
    );

    return {
      id: user.id,
      username: user.username,
      FirstName: user.FirstName ?? null,
      LastName: user.LastName ?? null,
      fullname:
        [user.FirstName, user.LastName].filter(Boolean).join(' ').trim() || user.username || null,
      PersonID_Onec: user.PersonID_Onec ? maskNationalIdValue(user.PersonID_Onec) : null,
      phone: user.phone ?? null,
      email: user.email ?? null,
      affiliation: user.affiliation ?? null,
      // Cache-busted by updated_at so the internal storage key stays server-side.
      // The endpoint itself redirects to a fresh short-lived signed URL.
      photo_url: user.photo_url ?? null,
      line_id: profile?.line_id ?? null,
      role: user.role ?? null,
      roles: user.roles ?? [],
      labels: user.labels ?? [],
      permissions: user.permissions ?? [],
      status: user.status,
      data_scope: user.data_scope,
      must_change_password: user.must_change_password ?? false,
      temporary_password_issued_at: user.temporary_password_issued_at ?? null,
      temporary_password_expires_at: user.temporary_password_expires_at ?? null,
      deactivated_at: user.deactivated_at ?? null,
      deactivated_by: user.deactivated_by ?? null,
      deactivation_reason_code: user.deactivation_reason_code ?? null,
      deactivation_note: user.deactivation_note ?? null,
      created_at: user.created_at ?? null,
      student_uuid: studentUuid,
      has_profile_location: hasProfileLocation,
      data_scope_labels: {
        schools: schoolLabels,
        gradeLevels: gradeLevelLabels,
      },
    };
  }

  /** Own profile photo read — no manage-users permission, only being signed in. */
  async resolveOwnPhoto(actor: ActorContext | undefined): Promise<FileServeResult> {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const user = await this.usersRepository.findUserById(currentActor.id);
    if (!user?.photo_storage_key) {
      throw new NotFoundException('ไม่พบรูปประจำตัวผู้ใช้งาน');
    }
    const result = await this.storage.resolve(user.photo_storage_key);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวผู้ใช้งาน');
    return result;
  }

  /** Same upload/replace/cleanup contract as the admin path, scoped to self. */
  async updateOwnPhoto(
    actor: ActorContext | undefined,
    file?: Express.Multer.File,
    removePhoto?: boolean,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    if (file && removePhoto) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำรูปออกพร้อมกันได้');
    }
    if (!file && !removePhoto) {
      throw new BadRequestException('กรุณาเลือกรูปหรือระบุการนำรูปออก');
    }

    const current = await this.usersRepository.findUserById(currentActor.id);
    if (!current) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    const replacedStorageKey = current.photo_storage_key ?? null;
    const newStorageKey = file ? await processImageUpload(file, this.storage, 'user-photos') : null;

    try {
      await this.usersRepository.updateUserPhoto(currentActor.id, newStorageKey);
    } catch (error) {
      if (newStorageKey) {
        await this.storage.delete(newStorageKey).catch(() => {
          this.logger.warn(`Unable to delete unused profile photo for user ${currentActor.id}`);
        });
      }
      throw error;
    }

    try {
      await this.auditLog.record({
        actorUserId: resolveAuditActorId(actor),
        actorLabel: actor?.username ?? null,
        action: 'USER_PROFILE_UPDATE',
        targetType: 'user',
        targetId: String(currentActor.id),
        metadata: { op: newStorageKey ? 'update-photo' : 'remove-photo' },
        ip: null,
      });
    } catch (error) {
      this.logger.error(
        `Unable to audit own profile photo update for user ${currentActor.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (replacedStorageKey) {
      await this.storage.delete(replacedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete replaced profile photo for user ${currentActor.id}`);
      });
    }
    return await this.getOwnProfile(actor);
  }

  async getOwnProfile(actor: ActorContext | undefined) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const row = await this.usersRepository.findOwnProfileById(currentActor.id);
    if (!row) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }
    const user = this.usersPolicyService.hydrateUserPermissions(row, roleMap);
    const isStudent = user.roles?.includes('STUDENT') ?? false;
    const [studentUuid, studentContact, resolvedNationalId] = isStudent
      ? await Promise.all([
          this.usersRepository.findCurrentStudentUuidByUserId(user.id),
          this.usersRepository.findStudentPersonContactByUserId(user.id),
          this.usersRepository.findResolvedNationalIdByUserId(user.id),
        ])
      : [null, null, user.PersonID_Onec ?? null];
    const [schoolLabels, gradeLevelLabels] = await Promise.all([
      this.usersRepository.findSchoolNamesByIds(
        normalizeNumericScopeValues(user.data_scope?.school_ids),
      ),
      this.usersRepository.findGradeLevelLabelsByIds(
        normalizeNumericScopeValues(user.data_scope?.grade_levels),
      ),
    ]);
    return {
      ...user,
      // Same cache-busting contract as the admin list; the self route needs no
      // manage-users permission.
      photo_url: user.photo_storage_key
        ? `/api/users/me/photo?v=${encodeMediaVersion(user.updated_at)}`
        : null,
      PersonID_Onec: normalizeNationalIdValue(resolvedNationalId) || null,
      phone: studentContact?.has_canonical_contact ? studentContact.phone : (user.phone ?? null),
      email: studentContact?.has_canonical_contact ? studentContact.email : (user.email ?? null),
      line_id: studentContact?.has_canonical_contact
        ? studentContact.line_id
        : (user.line_id ?? null),
      student_uuid: studentUuid,
      data_scope_labels: {
        schools: schoolLabels,
        gradeLevels: gradeLevelLabels,
      },
    };
  }

  async updateOwnProfile(actor: ActorContext | undefined, data: UpdateOwnProfileDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const roleMap = await this.usersPolicyService.getRoleMap();
    const existingRow = await this.usersRepository.findOwnProfileById(currentActor.id);

    if (!existingRow) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);
    const isStudent = existingUser.roles?.includes('STUDENT') ?? false;
    const studentContact = isStudent
      ? await this.usersRepository.findStudentPersonContactByUserId(currentActor.id)
      : null;
    if (isStudent && !studentContact) {
      throw new BadRequestException('บัญชีนักเรียนยังไม่ได้เชื่อมกับข้อมูลบุคคล');
    }
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

    const phone =
      data.phone !== undefined
        ? cleanNullableText(data.phone)
        : studentContact?.has_canonical_contact
          ? studentContact.phone
          : (existingUser.phone ?? null);
    const email =
      data.email !== undefined
        ? cleanNullableText(data.email)
        : studentContact?.has_canonical_contact
          ? studentContact.email
          : (existingUser.email ?? null);
    const lineId =
      data.line_id !== undefined
        ? cleanNullableText(data.line_id)
        : studentContact?.has_canonical_contact
          ? studentContact.line_id
          : (existingUser.line_id ?? null);
    const profileUpdate = {
      id: currentActor.id,
      firstName,
      lastName,
      phone,
      email,
      affiliation:
        data.affiliation !== undefined
          ? cleanNullableText(data.affiliation)
          : (existingUser.affiliation ?? null),
      lineId,
      addressLine:
        data.address_line !== undefined
          ? cleanNullableText(data.address_line)
          : (existingUser.address_line ?? null),
      addressVillageNo:
        data.address_village_no !== undefined
          ? cleanPrefixedAddressText('หมู่', data.address_village_no)
          : (existingUser.address_village_no ?? null),
      addressStreet:
        data.address_street !== undefined
          ? cleanPrefixedAddressText('ถนน', data.address_street)
          : (existingUser.address_street ?? null),
      addressSoi:
        data.address_soi !== undefined
          ? cleanPrefixedAddressText('ซอย', data.address_soi)
          : (existingUser.address_soi ?? null),
      addressTrok:
        data.address_trok !== undefined
          ? cleanPrefixedAddressText('ตรอก', data.address_trok)
          : (existingUser.address_trok ?? null),
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
    };

    await this.usersRepository.withTransaction(async (executor) => {
      await this.usersRepository.updateOwnProfile(profileUpdate, executor);
      if (studentContact) {
        await this.usersRepository.upsertStudentPersonContact(
          {
            personUuid: studentContact.person_uuid,
            phone,
            email,
            lineId,
            updatedBy: resolveAuditActorId(currentActor),
          },
          executor,
        );
      }
    });

    return await this.getOwnProfile(currentActor);
  }

  async createUser(actor: ActorContext | undefined, data: CreateUserDto) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      // Resolve the persisted scope BEFORE authorization: an empty scope means
      // nationwide (explicit global:true), and only an actor who is nationwide
      // themselves may grant it — never a silent pass-through of "{}".
      const persistedScope = finalizePersistedDataScope(data.data_scope);
      await this.usersPolicyService.assertAssignablePayload(
        currentActor,
        { ...data, data_scope: persistedScope },
        { allowEqualRole: false },
        roleMap,
      );
      const primaryRole = this.usersPolicyService.normalizeRole(data);
      const teacherSchoolIds = this.resolveTeacherSchoolIds(primaryRole, persistedScope);

      const usesTemporaryPassword = data.password == null;
      const password = data.password ?? this.passwordService.generateTempPassword();
      if ((data.address_latitude == null) !== (data.address_longitude == null)) {
        throw new BadRequestException('กรุณาระบุ latitude และ longitude ให้ครบทั้งคู่');
      }
      const generatedTempPassword = usesTemporaryPassword ? password : undefined;

      // Only system-generated passwords start the temporary-password lifecycle.
      // An explicit administrator-provided password is usable immediately.
      const temporaryPasswordIssuedAt = usesTemporaryPassword ? new Date() : null;
      const temporaryPasswordExpiresAt = temporaryPasswordIssuedAt
        ? new Date(
            temporaryPasswordIssuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000,
          )
        : null;

      const userId = await this.usersRepository.withTransaction(async (executor) => {
        if (await this.usersRepository.usernameExists(data.username, executor)) {
          throw new ConflictException(USERNAME_ALREADY_USED_MESSAGE);
        }
        const passwordHash = await this.passwordService.hash(password);
        const createdUserId = await this.usersRepository.createUser(
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
            lineId: cleanNullableText(data.line_id),
            addressLine: cleanNullableText(data.address_line),
            addressVillageNo: cleanPrefixedAddressText('หมู่', data.address_village_no),
            addressStreet: cleanPrefixedAddressText('ถนน', data.address_street),
            addressSoi: cleanPrefixedAddressText('ซอย', data.address_soi),
            addressTrok: cleanPrefixedAddressText('ตรอก', data.address_trok),
            addressSubDistrict: cleanNullableText(data.address_sub_district),
            addressDistrict: cleanNullableText(data.address_district),
            addressProvince: cleanNullableText(data.address_province),
            addressPostalCode: cleanNullableText(data.address_postal_code),
            addressLatitude: data.address_latitude ?? null,
            addressLongitude: data.address_longitude ?? null,
            status: data.status || 'ACTIVE',
            permissions: data.permissions || [],
            role: primaryRole,
            dataScope: persistedScope,
            mustChangePassword: usesTemporaryPassword,
            temporaryPasswordIssuedAt,
            temporaryPasswordExpiresAt,
            createdBy: resolveAuditActorId(currentActor),
          },
          executor,
        );
        await this.reconcileTeacherMemberships(
          createdUserId,
          teacherSchoolIds,
          currentActor,
          executor,
        );
        return createdUserId;
      });

      return {
        success: true,
        userId,
        tempPassword: generatedTempPassword || undefined,
        must_change_password: usesTemporaryPassword,
      };
    } catch (err) {
      if (err instanceof ConflictException) {
        throw err;
      }
      if (this.isUsernameUniqueViolation(err)) {
        throw new ConflictException(USERNAME_ALREADY_USED_MESSAGE);
      }
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
      const existingRole =
        this.usersPolicyService.getPrimaryRole(existingUser) ??
        this.usersPolicyService.normalizeRole({
          role: existingUser.role ?? undefined,
          roles: existingUser.roles ?? undefined,
        });
      const roleWasProvided =
        (typeof data.role === 'string' && data.role.trim().length > 0) ||
        (Array.isArray(data.roles) && data.roles.some((role) => role.trim().length > 0));
      const requestedRole = roleWasProvided
        ? this.usersPolicyService.normalizeRole(data)
        : existingRole;
      const persistedScope = finalizePersistedDataScope(data.data_scope ?? existingUser.data_scope);

      if (isSelf && requestedRole !== existingRole) {
        throw new ForbiddenException('ไม่สามารถเปลี่ยนตำแหน่งของบัญชีตัวเองได้');
      }

      await this.usersPolicyService.assertAssignablePayload(
        currentActor,
        { ...data, role: requestedRole, roles: undefined, data_scope: persistedScope },
        { allowEqualRole: isSelf },
        roleMap,
      );

      const primaryRole = requestedRole;
      const teacherSchoolIds = this.resolveTeacherSchoolIds(primaryRole, persistedScope);

      await this.usersRepository.withTransaction(async (executor) => {
        if (
          data.username !== undefined &&
          data.username !== existingUser.username &&
          (await this.usersRepository.usernameExists(data.username, executor))
        ) {
          throw new ConflictException(USERNAME_ALREADY_USED_MESSAGE);
        }
        const passwordHash = data.password
          ? await this.passwordService.hash(data.password)
          : undefined;
        const addressLatitude = data.address_latitude ?? existingUser.address_latitude ?? null;
        const addressLongitude = data.address_longitude ?? existingUser.address_longitude ?? null;
        if ((addressLatitude === null) !== (addressLongitude === null)) {
          throw new BadRequestException('กรุณาระบุ latitude และ longitude ให้ครบทั้งคู่');
        }

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
            lineId:
              data.line_id !== undefined
                ? cleanNullableText(data.line_id)
                : (existingUser.line_id ?? null),
            addressLine:
              data.address_line !== undefined
                ? cleanNullableText(data.address_line)
                : (existingUser.address_line ?? null),
            addressVillageNo: cleanPrefixedAddressText(
              'หมู่',
              data.address_village_no !== undefined
                ? data.address_village_no
                : existingUser.address_village_no,
            ),
            addressStreet: cleanPrefixedAddressText(
              'ถนน',
              data.address_street !== undefined ? data.address_street : existingUser.address_street,
            ),
            addressSoi: cleanPrefixedAddressText(
              'ซอย',
              data.address_soi !== undefined ? data.address_soi : existingUser.address_soi,
            ),
            addressTrok: cleanPrefixedAddressText(
              'ตรอก',
              data.address_trok !== undefined ? data.address_trok : existingUser.address_trok,
            ),
            addressSubDistrict: cleanNullableText(
              data.address_sub_district !== undefined
                ? data.address_sub_district
                : existingUser.address_sub_district,
            ),
            addressDistrict: cleanNullableText(
              data.address_district !== undefined
                ? data.address_district
                : existingUser.address_district,
            ),
            addressProvince: cleanNullableText(
              data.address_province !== undefined
                ? data.address_province
                : existingUser.address_province,
            ),
            addressPostalCode: cleanNullableText(
              data.address_postal_code !== undefined
                ? data.address_postal_code
                : existingUser.address_postal_code,
            ),
            addressLatitude,
            addressLongitude,
            status: data.status ?? existingUser.status ?? 'ACTIVE',
            permissions:
              data.permissions ??
              this.usersPolicyService.normalizePermissionList(existingUser.permissions),
            role: primaryRole,
            dataScope: persistedScope,
            updatedBy: resolveAuditActorId(currentActor),
          },
          executor,
        );
        await this.reconcileTeacherMemberships(id, teacherSchoolIds, currentActor, executor);
      });

      return { success: true };
    } catch (err) {
      if (err instanceof ConflictException) {
        throw err;
      }
      if (this.isUsernameUniqueViolation(err)) {
        throw new ConflictException(USERNAME_ALREADY_USED_MESSAGE);
      }
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
    data: DeactivateUserAccountDto,
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
            ...auditMeta.metadata,
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
          metadata: { username: existingUser.username, ...auditMeta.metadata },
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

  // General reissue for any role the actor may manage (Manage Users page),
  // guarded by the same role-hierarchy/scope check as edit/delete.
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

  async getRoles(actor?: ActorContext) {
    if (!actor) {
      return await this.usersPolicyService.getRoleDefinitions();
    }

    const actorScope = this.usersPolicyService.normalizeScope(actor.data_scope);
    const ownedSchoolId =
      actorScope.global !== true && actorScope.school_ids.length === 1
        ? Number(actorScope.school_ids[0])
        : null;
    const definitions = await this.usersPolicyService.getRoleDefinitions(false, ownedSchoolId);
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

  private normalizeDeactivationReason(data: DeactivateUserAccountDto): {
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private isUsernameUniqueViolation(error: unknown): boolean {
    if (!this.isUniqueViolation(error) || typeof error !== 'object' || error === null) {
      return false;
    }
    const directConstraint = 'constraint' in error ? error.constraint : undefined;
    const driverError =
      'driverError' in error && typeof error.driverError === 'object' && error.driverError !== null
        ? error.driverError
        : undefined;
    const driverConstraint =
      driverError && 'constraint' in driverError ? driverError.constraint : undefined;
    const constraint =
      typeof directConstraint === 'string'
        ? directConstraint
        : typeof driverConstraint === 'string'
          ? driverConstraint
          : '';
    return constraint.toLowerCase().includes('username');
  }
}

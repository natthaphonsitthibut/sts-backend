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
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { PasswordService } from '../auth/password.service';
import type {
  ChangePasswordDto,
  CreateUserDto,
  GenerateStudentAccountsDto,
  StudentAccountBulkFilterDto,
  UpdateUserDto,
} from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository, type UserListFilters } from './users.repository';
import type {
  ActorContext,
  DataScope,
  QueryExecutor,
  StudentAccountCandidateRow,
} from './users.types';

const STUDENT_ACCOUNT_PERMISSIONS = ['home', 'student-self'] as const;
const STUDENT_ACCOUNT_ROLE = 'STUDENT';
const STUDENT_ACCOUNT_BATCH_LIMIT = 200;
const STUDENT_TEMP_PASSWORD_TTL_DAYS = 7;
const USERNAME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
    private readonly passwordService: PasswordService,
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
    const { rows, totalCount } = await this.usersRepository.listUsersPaginated({
      actorId: currentActor.id,
      actorRole,
      actorRank,
      actorScope: currentActor.data_scope,
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
      meta: buildPaginationMeta(page, limit, totalCount),
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

    return user;
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

      const rowCount = await this.usersRepository.withTransaction(async (executor) => {
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
          temporaryPasswordIssuedAt.getTime() +
            STUDENT_TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000,
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

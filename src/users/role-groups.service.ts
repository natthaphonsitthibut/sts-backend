import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSION_CATALOG } from '../auth/permissions.constants';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type { CreateRoleGroupDto, UpdateRoleGroupDto } from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import type { ActorContext, RoleDefinition } from './users.types';

interface RoleGroupListOptions {
  searchTerm?: string;
  page?: number;
  limit?: number;
  schoolId?: number;
  sortBy?: 'group' | 'menus';
  sortDirection?: 'asc' | 'desc';
}

const PERMISSION_LABELS = new Map(PERMISSION_CATALOG.map((item) => [item.id, item.label]));

function menuLabel(role: RoleDefinition): string {
  return role.default_permissions
    .map((permission) => PERMISSION_LABELS.get(permission) ?? permission)
    .join(', ');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class RoleGroupsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
  ) {}

  private async resolveSchoolId(actor: ActorContext, requestedSchoolId?: number): Promise<number> {
    let schoolId = requestedSchoolId;
    if (!schoolId) {
      const scope = this.usersPolicyService.normalizeScope(actor.data_scope);
      if (!scope.global && scope.school_ids.length === 1) {
        const inferredSchoolId = Number(scope.school_ids[0]);
        if (Number.isInteger(inferredSchoolId) && inferredSchoolId > 0) {
          schoolId = inferredSchoolId;
        }
      }
    }
    if (!schoolId) {
      throw new BadRequestException('กรุณาเลือกโรงเรียนก่อนจัดการกลุ่มเมนู');
    }
    const allowed = await this.usersRepository.isSchoolInScope(schoolId, actor.data_scope || {});
    if (!allowed) {
      throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
    }
    return schoolId;
  }

  private async assertScopedRoleAccess(actor: ActorContext, role: RoleDefinition): Promise<number> {
    if (role.school_id == null || role.is_system) {
      throw new ForbiddenException('กลุ่มระบบไม่สามารถแก้ไขจากหน้ากลุ่มเมนูโรงเรียนได้');
    }
    return await this.resolveSchoolId(actor, role.school_id);
  }

  async getRoleGroups(actor?: ActorContext, options: RoleGroupListOptions = {}) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const schoolId = await this.resolveSchoolId(currentActor, options.schoolId);
    const schoolDefinitions = await this.usersPolicyService.getRoleDefinitions(true, schoolId);
    const definitions = schoolDefinitions.filter((role) => role.school_id === schoolId);
    const roleMap = new Map(schoolDefinitions.map((definition) => [definition.name, definition]));
    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });

    let visible = definitions.filter((role) =>
      this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        role.default_permissions || [],
        actorRole,
        roleMap,
      ),
    );

    const search = options.searchTerm?.trim().toLocaleLowerCase('th');
    if (search) {
      visible = visible.filter(
        (role) =>
          role.label.toLocaleLowerCase('th').includes(search) ||
          menuLabel(role).toLocaleLowerCase('th').includes(search),
      );
    }

    const sortBy = options.sortBy ?? 'group';
    const direction = options.sortDirection === 'desc' ? -1 : 1;
    visible.sort((left, right) => {
      const leftText = sortBy === 'menus' ? menuLabel(left) : left.label;
      const rightText = sortBy === 'menus' ? menuLabel(right) : right.label;
      const compared = leftText.localeCompare(rightText, 'th');
      return compared === 0 ? left.name.localeCompare(right.name) : compared * direction;
    });

    const page = resolvePage(options.page);
    const limit = resolveLimit(options.limit);
    const start = (page - 1) * limit;

    return {
      success: true,
      data: visible.slice(start, start + limit),
      meta: buildPaginationMeta(page, limit, visible.length),
    };
  }

  async createRoleGroup(actor: ActorContext | undefined, data: CreateRoleGroupDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const schoolId = await this.resolveSchoolId(currentActor, data.schoolId);
    const definitions = await this.usersPolicyService.getRoleDefinitions(false, schoolId);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const internalName = `S${schoolId}_${randomUUID()
      .replaceAll('-', '')
      .slice(0, 24)
      .toUpperCase()}`;
    const payload = this.usersPolicyService.normalizeRoleGroupPayload({
      ...data,
      name: internalName,
      scope_mode: 'school',
    });

    if (await this.usersRepository.schoolRoleLabelExists(schoolId, payload.label)) {
      throw new BadRequestException('มีกลุ่มเมนูชื่อนี้ในโรงเรียนแล้ว');
    }

    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });
    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        payload.default_permissions,
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่สามารถกำหนดเมนูที่ตนเองไม่มีสิทธิ์เข้าถึงได้');
    }

    try {
      const row = await this.usersRepository.createRole({ ...payload, school_id: schoolId });
      return { success: true, role: this.usersPolicyService.mapRoleRow(row) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('มีกลุ่มเมนูชื่อนี้ในโรงเรียนแล้ว');
      }
      throw error;
    }
  }

  async updateRoleGroup(
    actor: ActorContext | undefined,
    roleName: string,
    data: UpdateRoleGroupDto,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const normalizedRoleName = this.usersPolicyService.normalizeRoleName(roleName);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const existingRole = roleMap.get(normalizedRoleName);
    if (!existingRole) throw new NotFoundException('ไม่พบกลุ่มเมนู');
    const schoolId = await this.assertScopedRoleAccess(currentActor, existingRole);

    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });
    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        existingRole.default_permissions || [],
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการกลุ่มเมนูนี้');
    }
    const payload = this.usersPolicyService.normalizeRoleGroupPayload(data, existingRole);
    if (
      await this.usersRepository.schoolRoleLabelExists(schoolId, payload.label, existingRole.name)
    ) {
      throw new BadRequestException('มีกลุ่มเมนูชื่อนี้ในโรงเรียนแล้ว');
    }
    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        payload.default_permissions,
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่สามารถกำหนดเมนูที่ตนเองไม่มีสิทธิ์เข้าถึงได้');
    }

    try {
      const row = await this.usersRepository.updateRole(existingRole.name, payload);
      return { success: true, role: this.usersPolicyService.mapRoleRow(row) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('มีกลุ่มเมนูชื่อนี้ในโรงเรียนแล้ว');
      }
      throw error;
    }
  }

  async deleteRoleGroup(actor: ActorContext | undefined, roleName: string) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const normalizedRoleName = this.usersPolicyService.normalizeRoleName(roleName);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const existingRole = roleMap.get(normalizedRoleName);
    if (!existingRole) throw new NotFoundException('ไม่พบกลุ่มเมนู');
    await this.assertScopedRoleAccess(currentActor, existingRole);

    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });
    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        existingRole.default_permissions || [],
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์ลบกลุ่มเมนูนี้');
    }
    if ((existingRole.user_count || 0) > 0) {
      throw new ForbiddenException('ไม่สามารถลบกลุ่มเมนูที่ยังมีผู้ใช้งานอยู่ได้');
    }

    await this.usersRepository.deleteRole(existingRole.name);
    return { success: true };
  }
}

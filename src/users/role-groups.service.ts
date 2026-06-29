import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateRoleGroupDto, UpdateRoleGroupDto } from './dto/users.dto';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import type { ActorContext, RoleDefinition } from './users.types';

interface RoleGroupListOptions {
  searchTerm?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class RoleGroupsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
  ) {}

  private assertGlobalRoleManagement(actor: ActorContext): void {
    if (!this.usersPolicyService.isScopeGlobal(actor.data_scope)) {
      throw new ForbiddenException('จัดการกลุ่มสิทธิ์ได้เฉพาะผู้ดูแลขอบเขตทั้งระบบ');
    }
  }

  // Role definitions are a small, bounded *config* set (tens of rows, bounded by
  // design — not by population), so this is intentionally a Class-B bounded
  // management catalog: the policy filter runs in memory and the page is sliced
  // from the filtered set. Do NOT "optimize" this into SQL-level COUNT/LIMIT —
  // visibility is gated per-actor by runtime policy (canManageRole /
  // canGrantPermissions, which compare the actor's rank and grantable
  // permissions), which cannot be expressed as plain column predicates.
  // Pushing it into SQL would duplicate the security logic into a second source
  // of truth and risk scope-bypass / totalCount divergence whenever the
  // permission rules change. The contract (PaginatedSearchQueryDto + { success,
  // data, meta }) is already uniform with /api/users.
  async getRoleGroups(actor?: ActorContext, options: RoleGroupListOptions = {}) {
    const definitions = await this.usersPolicyService.getRoleDefinitions(true);

    let visible: RoleDefinition[] = definitions;
    if (actor) {
      const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
      const actorRole = this.usersPolicyService.getPrimaryRole({
        roles: actor.roles,
      });

      visible = definitions.filter(
        (role) =>
          this.usersPolicyService.canManageRole(actorRole, role.name, roleMap) &&
          this.usersPolicyService.canGrantPermissions(
            actor.permissions || [],
            role.default_permissions || [],
            actorRole,
            roleMap,
          ),
      );
    }

    const search = options.searchTerm?.trim().toLowerCase();
    if (search) {
      visible = visible.filter(
        (role) =>
          (role.label || '').toLowerCase().includes(search) ||
          (role.name || '').toLowerCase().includes(search),
      );
    }

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
    this.assertGlobalRoleManagement(currentActor);
    const definitions = await this.usersPolicyService.getRoleDefinitions();
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const payload = this.usersPolicyService.normalizeRoleGroupPayload(data);

    if (roleMap.has(payload.name)) {
      throw new BadRequestException('มีกลุ่มผู้ใช้งานนี้อยู่แล้ว');
    }

    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: currentActor.roles,
    });
    const actorRank = this.usersPolicyService.getRoleRank(actorRole, roleMap);
    if (payload.rank > actorRank || (payload.rank === actorRank && actorRole !== 'ADMIN')) {
      throw new ForbiddenException(
        'ไม่สามารถสร้างกลุ่มผู้ใช้งานที่มีลำดับสิทธิ์สูงกว่าหรือเทียบเท่าตนเองได้',
      );
    }

    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        payload.default_permissions,
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่สามารถกำหนดสิทธิ์เริ่มต้นที่ตนเองไม่มีได้');
    }

    const row = await this.usersRepository.createRole(payload);

    return {
      success: true,
      role: this.usersPolicyService.mapRoleRow(row),
    };
  }

  async updateRoleGroup(
    actor: ActorContext | undefined,
    roleName: string,
    data: UpdateRoleGroupDto,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertGlobalRoleManagement(currentActor);
    const normalizedRoleName = this.usersPolicyService.normalizeRoleName(roleName);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const existingRole = roleMap.get(normalizedRoleName);

    if (!existingRole) {
      throw new NotFoundException('ไม่พบกลุ่มผู้ใช้งาน');
    }

    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: currentActor.roles,
    });
    if (!this.usersPolicyService.canManageRole(actorRole, existingRole.name, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการกลุ่มผู้ใช้งานนี้');
    }

    const payload = this.usersPolicyService.normalizeRoleGroupPayload(data, existingRole);
    const actorRank = this.usersPolicyService.getRoleRank(actorRole, roleMap);
    if (payload.rank > actorRank || (payload.rank === actorRank && actorRole !== 'ADMIN')) {
      throw new ForbiddenException('ไม่สามารถกำหนดลำดับสิทธิ์สูงกว่าหรือเทียบเท่าตนเองได้');
    }

    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        payload.default_permissions,
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่สามารถกำหนดสิทธิ์เริ่มต้นที่ตนเองไม่มีได้');
    }

    const row = await this.usersRepository.updateRole(existingRole.name, payload);
    return {
      success: true,
      role: this.usersPolicyService.mapRoleRow(row),
    };
  }

  async deleteRoleGroup(actor: ActorContext | undefined, roleName: string) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertGlobalRoleManagement(currentActor);
    const normalizedRoleName = this.usersPolicyService.normalizeRoleName(roleName);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const existingRole = roleMap.get(normalizedRoleName);

    if (!existingRole) {
      throw new NotFoundException('ไม่พบกลุ่มผู้ใช้งาน');
    }

    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: currentActor.roles,
    });
    if (!this.usersPolicyService.canManageRole(actorRole, existingRole.name, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ลบกลุ่มผู้ใช้งานนี้');
    }

    if (existingRole.is_system) {
      throw new ForbiddenException('ไม่สามารถลบบทบาทระบบได้');
    }

    if ((existingRole.user_count || 0) > 0) {
      throw new ForbiddenException('ไม่สามารถลบบทบาทที่ยังมีผู้ใช้งานอยู่ได้');
    }

    if ((existingRole.login_link_count || 0) > 0) {
      throw new ForbiddenException('ไม่สามารถลบบทบาทที่ยังถูกใช้งานในลิงก์เข้าสู่ระบบได้');
    }

    await this.usersRepository.deleteRole(existingRole.name);
    return { success: true };
  }
}

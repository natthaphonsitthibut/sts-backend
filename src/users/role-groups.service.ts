import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateRoleGroupDto, UpdateRoleGroupDto } from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import type { ActorContext } from './users.types';

@Injectable()
export class RoleGroupsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
  ) {}

  async getRoleGroups(actor?: ActorContext) {
    const definitions = await this.usersPolicyService.getRoleDefinitions(true);
    if (!actor) {
      return definitions;
    }

    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: actor.roles,
    });

    return definitions.filter(
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

  async createRoleGroup(actor: ActorContext | undefined, data: CreateRoleGroupDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
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

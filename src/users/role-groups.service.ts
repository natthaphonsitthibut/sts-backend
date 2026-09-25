import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AREA_ROLE_TEMPLATES, PERMISSION_CATALOG } from '../auth/permissions.constants';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type { CreateRoleGroupDto, UpdateRoleGroupDto } from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository, type RoleOwnerAreaCodes } from './users.repository';
import type { ActorContext, RoleDefinition, RoleOwnerArea } from './users.types';

interface RoleGroupListOptions {
  searchTerm?: string;
  page?: number;
  limit?: number;
  schoolId?: number;
  province?: string;
  district?: string;
  subDistrict?: string;
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

interface AreaRequest {
  province?: string;
  district?: string;
  subDistrict?: string;
}

type ResolvedArea = Pick<RoleOwnerArea, 'province' | 'district' | 'sub_district'> &
  RoleOwnerAreaCodes;

/** The group belongs to exactly this area. */
function isOwnedBy(owner: RoleOwnerArea | null | undefined, area: ResolvedArea): boolean {
  return Boolean(
    owner &&
    owner.province_code === area.province_code &&
    (owner.district_code ?? null) === (area.district_code ?? null) &&
    (owner.sub_district_code ?? null) === (area.sub_district_code ?? null),
  );
}

@Injectable()
export class RoleGroupsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
  ) {}

  /**
   * Council menu groups belong to a จ./อ./ต., like a school's belong to the
   * school (owner with BA, 2026-09-25). Any council account holding จัดการกลุ่ม
   * เมนู manages the groups of the areas in its scope; a school account never.
   */
  private assertCouncilActor(actor: ActorContext): void {
    const scope = this.usersPolicyService.normalizeScope(actor.data_scope);
    if (scope.school_ids.length > 0 || (!scope.global && scope.provinces.length === 0)) {
      throw new ForbiddenException(
        'บัญชีที่ไม่ได้อยู่ในขอบเขตส่วนกลางจัดการกลุ่มเมนูส่วนกลางไม่ได้',
      );
    }
  }

  /**
   * The area whose groups are managed: the จ./อ./ต. picked in the header, else
   * an area account's own. There is no "no area" — like a school must be picked
   * on the school side. Its two starter groups are created on first use.
   */
  private async resolveCouncilArea(
    actor: ActorContext,
    requested: AreaRequest,
  ): Promise<ResolvedArea> {
    const scope = this.usersPolicyService.normalizeScope(actor.data_scope);
    const area: Pick<RoleOwnerArea, 'province' | 'district' | 'sub_district'> | null =
      requested.province
        ? {
            province: requested.province,
            district: requested.district || null,
            sub_district: requested.district ? requested.subDistrict || null : null,
          }
        : scope.global
          ? null
          : this.usersPolicyService.scopeArea(actor.data_scope);
    if (!area) {
      throw new BadRequestException('กรุณาเลือกจังหวัด อำเภอ หรือตำบลก่อนจัดการกลุ่มเมนู');
    }
    if (
      !scope.global &&
      !this.usersPolicyService.isScopeSubsetOfActor(
        this.usersPolicyService.areaAsScope(area),
        actor.data_scope,
      )
    ) {
      throw new NotFoundException('ไม่พบพื้นที่ในขอบเขตของคุณ');
    }
    const codes = await this.usersRepository.resolveAreaCodes({
      province: area.province,
      district: area.district,
      subDistrict: area.sub_district,
    });
    if (!codes) throw new BadRequestException('ไม่พบพื้นที่ที่เลือก');
    await this.usersRepository.ensureAreaDefaultRoles(codes, AREA_ROLE_TEMPLATES);
    return { ...area, ...codes };
  }

  /** An area group, of an area inside the actor's scope. */
  private assertCouncilGroupInReach(actor: ActorContext, role: RoleDefinition | undefined): void {
    if (!role?.owner_area || role.school_id != null) {
      throw new NotFoundException('ไม่พบกลุ่มเมนูส่วนกลาง');
    }
    const scope = this.usersPolicyService.normalizeScope(actor.data_scope);
    if (
      !scope.global &&
      !this.usersPolicyService.isScopeSubsetOfActor(
        this.usersPolicyService.areaAsScope(role.owner_area),
        actor.data_scope,
      )
    ) {
      throw new NotFoundException('ไม่พบกลุ่มเมนูส่วนกลาง');
    }
  }

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

  async getCouncilRoleGroups(actor?: ActorContext, options: RoleGroupListOptions = {}) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCouncilActor(currentActor);
    const area = await this.resolveCouncilArea(currentActor, options);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true, null);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });
    let visible = definitions.filter(
      (role) =>
        isOwnedBy(role.owner_area, area) &&
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

  async createCouncilRoleGroup(actor: ActorContext | undefined, data: CreateRoleGroupDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCouncilActor(currentActor);
    const area = await this.resolveCouncilArea(currentActor, data);
    const definitions = await this.usersPolicyService.getRoleDefinitions(false, null);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const code = area.sub_district_code ?? area.district_code ?? area.province_code;
    const internalName = `A${code}_${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
    const payload = this.usersPolicyService.normalizeRoleGroupPayload({
      ...data,
      name: internalName,
      scope_mode: 'flexible',
    });

    if (await this.usersRepository.areaRoleLabelExists(area, payload.label)) {
      throw new BadRequestException('มีกลุ่มเมนูชื่อนี้ในพื้นที่นี้แล้ว');
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
      const row = await this.usersRepository.createRole({
        ...payload,
        school_id: null,
        owner_area: area,
      });
      return { success: true, role: this.usersPolicyService.mapRoleRow(row) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('มีกลุ่มเมนูชื่อนี้ในพื้นที่นี้แล้ว');
      }
      throw error;
    }
  }

  async updateCouncilRoleGroup(
    actor: ActorContext | undefined,
    roleName: string,
    data: UpdateRoleGroupDto,
  ) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCouncilActor(currentActor);
    const normalizedRoleName = this.usersPolicyService.normalizeRoleName(roleName);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true, null);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const existingRole = roleMap.get(normalizedRoleName);
    this.assertCouncilGroupInReach(currentActor, existingRole);
    const role = existingRole!;
    const area = role.owner_area!;

    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });
    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        role.default_permissions || [],
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการกลุ่มเมนูนี้');
    }

    const payload = this.usersPolicyService.normalizeRoleGroupPayload(
      { ...data, scope_mode: 'flexible' },
      role,
    );
    if (await this.usersRepository.areaRoleLabelExists(area, payload.label, role.name)) {
      throw new BadRequestException('มีกลุ่มเมนูชื่อนี้ในพื้นที่นี้แล้ว');
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
      const row = await this.usersRepository.updateRole(role.name, payload);
      return { success: true, role: this.usersPolicyService.mapRoleRow(row) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('มีกลุ่มเมนูชื่อนี้ในพื้นที่นี้แล้ว');
      }
      throw error;
    }
  }

  async deleteCouncilRoleGroup(actor: ActorContext | undefined, roleName: string) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCouncilActor(currentActor);
    const normalizedRoleName = this.usersPolicyService.normalizeRoleName(roleName);
    const definitions = await this.usersPolicyService.getRoleDefinitions(true, null);
    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const existingRole = roleMap.get(normalizedRoleName);
    this.assertCouncilGroupInReach(currentActor, existingRole);
    const role = existingRole!;

    const actorRole = this.usersPolicyService.getPrimaryRole({ roles: currentActor.roles });
    if (
      !this.usersPolicyService.canGrantPermissions(
        currentActor.permissions || [],
        role.default_permissions || [],
        actorRole,
        roleMap,
      )
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์ลบกลุ่มเมนูนี้');
    }
    if ((role.user_count || 0) > 0) {
      throw new ForbiddenException('ไม่สามารถลบกลุ่มเมนูที่ยังมีผู้ใช้งานอยู่ได้');
    }

    await this.usersRepository.deleteRole(role.name);
    return { success: true };
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

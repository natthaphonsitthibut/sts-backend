import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  ROLE_BASELINES,
  ROLE_LABELS,
  VALID_PERMISSION_IDS,
  getRoleScopeValidationError,
  type RoleScopeMode,
  type RoleScopePolicy,
} from '../auth/permissions.constants';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { canManageRole, roleReachesFurtherThanActor } from '../auth/role-authority';
import type {
  CreateRoleGroupDto,
  CreateUserDto,
  UpdateRoleGroupDto,
  UpdateUserDto,
} from './dto/users.dto';
import { UsersRepository } from './users.repository';
import type {
  ActorContext,
  DataScope,
  HydratableUserRow,
  RoleDefinition,
  RoleRow,
} from './users.types';

@Injectable()
export class UsersPolicyService {
  constructor(private readonly usersRepository: UsersRepository) {}

  normalizePermissionList(permissions: unknown): string[] {
    if (!Array.isArray(permissions)) {
      return [];
    }

    return Array.from(
      new Set(
        permissions.filter(
          (permission): permission is string =>
            typeof permission === 'string' && permission.trim().length > 0,
        ),
      ),
    );
  }

  normalizeScope(
    scope: unknown,
  ): Required<Omit<DataScope, 'own_only'>> & Pick<DataScope, 'own_only'> {
    const source = scope && typeof scope === 'object' ? (scope as DataScope) : {};
    const normalizeArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }

      return Array.from(
        new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
      );
    };

    return {
      global: source.global === true,
      provinces: normalizeArray(source.provinces),
      districts: normalizeArray(source.districts),
      sub_districts: normalizeArray(source.sub_districts),
      school_ids: normalizeArray(source.school_ids),
      grade_levels: normalizeArray(source.grade_levels),
      room_ids: normalizeArray(source.room_ids),
      own_only: source.own_only === true,
    };
  }

  normalizeRoleName(name: unknown): string {
    if (typeof name !== 'string') {
      return '';
    }

    return name.trim().toUpperCase().replace(/\s+/g, '_');
  }

  normalizeScopeMode(mode: unknown): RoleScopeMode {
    if (
      mode === 'global' ||
      mode === 'province' ||
      mode === 'district' ||
      mode === 'sub_district' ||
      mode === 'school'
    ) {
      return mode;
    }

    return 'flexible';
  }

  mapRoleRow(row: RoleRow): RoleDefinition {
    return {
      id: Number(row.id),
      name: String(row.name),
      label: String(row.label),
      default_permissions: this.normalizePermissionList(row.default_permissions),
      scope_mode: this.normalizeScopeMode(row.scope_mode),
      scope_policy: row.scope_policy === 'OWN_ONLY' ? 'OWN_ONLY' : 'ASSIGNABLE',
      is_assignable: row.is_assignable !== false,
      is_system: row.is_system === true,
      school_id: row.school_id == null ? null : Number(row.school_id),
      user_count: row.user_count !== undefined ? Number(row.user_count) || 0 : undefined,
    };
  }

  async getRoleDefinitions(
    includeUsage = false,
    schoolId?: number | null,
  ): Promise<RoleDefinition[]> {
    const rows = await this.usersRepository.listRoleRows(includeUsage, schoolId);
    return rows.map((row) => this.mapRoleRow(row));
  }

  async getRoleMap(includeUsage = false): Promise<Map<string, RoleDefinition>> {
    const definitions = await this.getRoleDefinitions(includeUsage);
    return new Map(definitions.map((definition) => [definition.name, definition]));
  }

  getRoleLabel(role?: string | null, roleMap?: Map<string, RoleDefinition>): string {
    if (!role) {
      return '';
    }

    return roleMap?.get(role)?.label || (roleMap ? role : ROLE_LABELS[role] || role);
  }

  getRoleDefaultPermissions(role?: string | null, roleMap?: Map<string, RoleDefinition>): string[] {
    if (!role) {
      return [];
    }

    const dbPermissions = roleMap?.get(role)?.default_permissions;
    if (Array.isArray(dbPermissions) && dbPermissions.length > 0) {
      return dbPermissions;
    }

    return roleMap ? [] : Array.from(new Set(ROLE_BASELINES[role] || []));
  }

  getRoleScopeMode(role?: string | null, roleMap?: Map<string, RoleDefinition>): RoleScopeMode {
    if (!role) {
      return 'flexible';
    }

    return roleMap?.get(role)?.scope_mode || 'flexible';
  }

  getRoleScopePolicy(role?: string | null, roleMap?: Map<string, RoleDefinition>): RoleScopePolicy {
    if (!role) {
      return 'ASSIGNABLE';
    }
    return roleMap?.get(role)?.scope_policy || 'ASSIGNABLE';
  }

  getPrimaryRole(user?: { role?: string | null; roles?: string[] | null } | null): string | null {
    if (user?.role && user.role.trim().length > 0) {
      return user.role.trim();
    }

    const firstRole = Array.isArray(user?.roles)
      ? user.roles.find(
          (role): role is string => typeof role === 'string' && role.trim().length > 0,
        )
      : null;

    return firstRole?.trim() || null;
  }

  /** See `canManageRole` in auth/role-authority — the rule lives there. */
  canManageRole(
    actorRole?: string | null,
    targetRole?: string | null,
    roleMap?: Map<string, RoleDefinition>,
  ): boolean {
    return canManageRole(actorRole, targetRole, roleMap ?? new Map<string, RoleDefinition>());
  }

  isScopeGlobal(scope: unknown): boolean {
    const normalized = this.normalizeScope(scope);
    return normalized.global === true;
  }

  isScopeSubsetOfActor(targetScope: unknown, actorScope: unknown): boolean {
    if (this.isScopeGlobal(actorScope)) {
      return true;
    }

    if (isUnconfiguredDataScope(actorScope)) {
      return false;
    }

    const actor = this.normalizeScope(actorScope);
    const target = this.normalizeScope(targetScope);
    if (target.global === true) {
      return false;
    }
    const keys: Array<keyof Omit<DataScope, 'own_only' | 'global'>> = [
      'provinces',
      'districts',
      'sub_districts',
      'school_ids',
      'grade_levels',
      'room_ids',
    ];

    for (const key of keys) {
      const actorValues = actor[key].map(String);
      const targetValues = target[key].map(String);

      if (actorValues.length === 0) {
        continue;
      }

      if (targetValues.length === 0) {
        return false;
      }

      if (!targetValues.every((value) => actorValues.includes(value))) {
        return false;
      }
    }

    if (actor.own_only === true && target.own_only !== true) {
      return false;
    }

    return true;
  }

  canGrantPermissions(
    actorPermissions: string[],
    targetPermissions: string[],
    actorRole?: string | null,
    roleMap?: Map<string, RoleDefinition>,
  ): boolean {
    void actorRole;
    void roleMap;
    const grantablePermissions = Array.from(new Set(actorPermissions));

    if (grantablePermissions.includes('*') || grantablePermissions.includes('ALL')) {
      return true;
    }

    return targetPermissions.every((permission) => grantablePermissions.includes(permission));
  }

  resolveDisplayPermissions(
    permissions: unknown,
    roleDefaultPermissions: unknown,
    fallbackRole?: string | null,
    roleMap?: Map<string, RoleDefinition>,
  ): string[] {
    if (Array.isArray(permissions)) {
      return this.normalizePermissionList(permissions);
    }

    const fallbackDefaults = this.normalizePermissionList(roleDefaultPermissions);
    if (fallbackDefaults.length > 0) {
      return fallbackDefaults;
    }

    return this.getRoleDefaultPermissions(fallbackRole, roleMap);
  }

  hydrateUserPermissions<T extends HydratableUserRow>(
    user: T,
    roleMap?: Map<string, RoleDefinition>,
  ): T {
    const roles = Array.isArray(user.roles)
      ? user.roles.filter(
          (role): role is string => typeof role === 'string' && role.trim().length > 0,
        )
      : [];
    const fallbackRole =
      typeof user.role === 'string' && user.role.trim().length > 0 ? user.role.trim() : null;
    const normalizedRoles = roles.length > 0 ? roles : fallbackRole ? [fallbackRole] : [];

    return {
      ...user,
      role: fallbackRole,
      roles: normalizedRoles,
      permissions: this.resolveDisplayPermissions(
        user.permissions,
        user.role_default_permissions,
        fallbackRole,
        roleMap,
      ),
    };
  }

  normalizeRole(data: Pick<CreateUserDto | UpdateUserDto, 'role' | 'roles'>): string {
    const requestedRole =
      (typeof data.role === 'string' && data.role.trim().length > 0
        ? data.role
        : Array.isArray(data.roles)
          ? data.roles.find(
              (role): role is string => typeof role === 'string' && role.trim().length > 0,
            )
          : null) || '';

    const normalized = requestedRole.trim();
    // The retired `TEACHER` role used to stand in here, which now resolves to a
    // role the catalogue no longer has and surfaces as a confusing denial.
    if (!normalized) throw new BadRequestException('กรุณาระบุตำแหน่งของผู้ใช้งาน');
    return normalized;
  }

  ensureActor(actor?: ActorContext): ActorContext {
    if (!actor?.id) {
      throw new ForbiddenException('ไม่ได้เข้าสู่ระบบ');
    }

    return actor;
  }

  assertValidPermissionList(permissionIds: string[]): void {
    const invalidPermissions = permissionIds.filter(
      (permissionId) => !VALID_PERMISSION_IDS.includes(permissionId),
    );

    if (invalidPermissions.length > 0) {
      throw new BadRequestException(`สิทธิ์ไม่ถูกต้อง: ${invalidPermissions.join(', ')}`);
    }
  }

  canManageUser(
    actor: ActorContext,
    target: {
      id?: number | null;
      role?: string | null;
      roles?: string[] | null;
      data_scope?: unknown;
    },
    roleMap?: Map<string, RoleDefinition>,
  ): boolean {
    if (actor.id === target.id) {
      return true;
    }

    const actorRole = this.getPrimaryRole({ roles: actor.roles });
    const targetRole = this.getPrimaryRole(target);

    if (!this.canManageRole(actorRole, targetRole, roleMap)) {
      return false;
    }

    return this.isScopeSubsetOfActor(target.data_scope, actor.data_scope);
  }

  async assertAssignablePayload(
    actor: ActorContext,
    data: Pick<CreateUserDto | UpdateUserDto, 'role' | 'roles' | 'permissions' | 'data_scope'>,
    options: { allowEqualRole: boolean },
    roleMap?: Map<string, RoleDefinition>,
  ): Promise<void> {
    const currentRoleMap = roleMap || (await this.getRoleMap());
    const actorRole = this.getPrimaryRole({ roles: actor.roles });
    const requestedRole = this.normalizeRole(data);
    const requestedDefinition = currentRoleMap.get(requestedRole);

    if (requestedDefinition?.is_assignable === false) {
      throw new BadRequestException(`ตำแหน่ง ${requestedRole} ไม่เปิดให้กำหนดกับบัญชีผู้ใช้`);
    }

    if (!requestedDefinition) {
      throw new ForbiddenException(`ไม่สามารถกำหนดตำแหน่ง ${requestedRole} ได้`);
    }

    if (requestedDefinition?.school_id != null) {
      const targetScope = this.normalizeScope(data.data_scope);
      const schoolIds = targetScope.school_ids.map(Number).filter(Number.isInteger);
      if (
        targetScope.global === true ||
        schoolIds.length !== 1 ||
        schoolIds[0] !== requestedDefinition.school_id
      ) {
        throw new ForbiddenException('กลุ่มเมนูนี้ใช้ได้เฉพาะผู้ใช้ในโรงเรียนเจ้าของกลุ่ม');
      }
    }

    // Assigning a group is the same question as managing one: it may not reach
    // a page the actor lacks. `allowEqualRole` keeps the one exception that
    // existed before — handing out your own group.
    const reachesFurther = roleReachesFurtherThanActor(actorRole, requestedRole, currentRoleMap);
    if (
      reachesFurther ||
      (!options.allowEqualRole && requestedRole === actorRole && actorRole !== 'ADMIN')
    ) {
      throw new ForbiddenException('ไม่สามารถกำหนดตำแหน่งที่เข้าถึงหน้าที่ตนเองไม่มีได้');
    }

    const requestedPermissions = this.normalizePermissionList(data.permissions);
    this.assertValidPermissionList(requestedPermissions);

    if (
      !this.canGrantPermissions(
        actor.permissions || [],
        requestedPermissions,
        actorRole,
        currentRoleMap,
      )
    ) {
      throw new ForbiddenException('ไม่สามารถกำหนดสิทธิ์ที่ตนเองไม่มีได้');
    }

    if (!this.isScopeSubsetOfActor(data.data_scope, actor.data_scope)) {
      throw new ForbiddenException('ไม่สามารถกำหนดขอบเขตข้อมูลกว้างกว่าสิทธิ์ของตนเองได้');
    }

    const roleScopeError = getRoleScopeValidationError(requestedRole, data.data_scope, {
      scopeMode: this.getRoleScopeMode(requestedRole, currentRoleMap),
      scopePolicy: this.getRoleScopePolicy(requestedRole, currentRoleMap),
      roleLabel: this.getRoleLabel(requestedRole, currentRoleMap),
    });
    if (roleScopeError) {
      throw new ForbiddenException(roleScopeError);
    }
  }

  normalizeRoleGroupPayload(
    data: CreateRoleGroupDto | UpdateRoleGroupDto,
    existing?: RoleDefinition | null,
  ): {
    name: string;
    label: string;
    default_permissions: string[];
    scope_mode: RoleScopeMode;
    scope_policy: RoleScopePolicy;
  } {
    const name = existing?.name || this.normalizeRoleName(data.name);
    if (!name) {
      throw new BadRequestException('กรุณากรอกรหัสกลุ่มผู้ใช้งาน');
    }

    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(name)) {
      throw new BadRequestException(
        'รหัสกลุ่มผู้ใช้งานต้องเป็นตัวพิมพ์ใหญ่ ภาษาอังกฤษ ตัวเลข หรือ _ และขึ้นต้นด้วยตัวอักษร',
      );
    }

    const label = typeof data.label === 'string' ? data.label.trim() : '';
    if (!label) {
      throw new BadRequestException('กรุณากรอกชื่อกลุ่มผู้ใช้งาน');
    }

    const defaultPermissions = this.normalizePermissionList(
      data.default_permissions ?? data.permissions,
    );
    this.assertValidPermissionList(defaultPermissions);
    if (defaultPermissions.length === 0) {
      throw new BadRequestException('กรุณาเลือกสิทธิ์เริ่มต้นอย่างน้อย 1 รายการ');
    }

    return {
      name,
      label,
      default_permissions: defaultPermissions,
      scope_mode: this.normalizeScopeMode(data.scope_mode),
      scope_policy: existing?.scope_policy || 'ASSIGNABLE',
    };
  }
}

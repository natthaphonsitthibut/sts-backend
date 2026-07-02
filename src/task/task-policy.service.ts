import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  GRANT_EXEMPT_PERMISSION_IDS,
  getRoleScopeValidationError,
  ROLE_BASELINES,
  ROLE_LABELS,
  ROLE_RANKS,
  VALID_PERMISSION_IDS,
  type RoleScopeMode,
  type RoleScopePolicy,
} from '../auth/permissions.constants';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { TaskRepository } from './task.repository';
import type { ActorContext, DataScope, NormalizedDataScope, RoleDefinition } from './task.types';

@Injectable()
export class TaskPolicyService {
  constructor(private readonly taskRepository: TaskRepository) {}

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

  normalizeScope(scope: unknown): NormalizedDataScope {
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

  async getRoleDefinitions(): Promise<RoleDefinition[]> {
    return await this.taskRepository.getRoleDefinitions();
  }

  async getRoleMap(): Promise<Map<string, RoleDefinition>> {
    const definitions = await this.getRoleDefinitions();
    return new Map(definitions.map((definition) => [definition.name, definition]));
  }

  getRoleRank(role?: string | null, roleMap?: Map<string, RoleDefinition>): number {
    if (!role) {
      return 0;
    }

    const dbRank = roleMap?.get(role)?.rank;
    if (typeof dbRank === 'number' && dbRank > 0) {
      return dbRank;
    }

    return roleMap ? 0 : ROLE_RANKS[role] || 0;
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

    const scopeMode = roleMap?.get(role)?.scope_mode;
    return (typeof scopeMode === 'string' ? scopeMode : 'flexible') as RoleScopeMode;
  }

  getRoleScopePolicy(role?: string | null, roleMap?: Map<string, RoleDefinition>): RoleScopePolicy {
    if (!role) {
      return 'ASSIGNABLE';
    }
    return roleMap?.get(role)?.scope_policy || 'ASSIGNABLE';
  }

  assertValidPermissionList(permissionIds: string[]): void {
    const invalidPermissions = permissionIds.filter(
      (permissionId) => !VALID_PERMISSION_IDS.includes(permissionId),
    );
    if (invalidPermissions.length > 0) {
      throw new BadRequestException(`สิทธิ์ไม่ถูกต้อง: ${invalidPermissions.join(', ')}`);
    }
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

  normalizeRole(data: unknown, fallbackRole = 'TEACHER'): string {
    const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const requestedRole =
      (typeof payload.role === 'string' && payload.role.trim().length > 0
        ? payload.role
        : typeof payload.selected_role === 'string' && payload.selected_role.trim().length > 0
          ? payload.selected_role
          : Array.isArray(payload.roles)
            ? payload.roles.find(
                (role: unknown): role is string =>
                  typeof role === 'string' && role.trim().length > 0,
              )
            : null) || fallbackRole;

    return requestedRole.trim();
  }

  canManageRole(
    actorRole?: string | null,
    targetRole?: string | null,
    roleMap?: Map<string, RoleDefinition>,
  ): boolean {
    const actorRank = this.getRoleRank(actorRole, roleMap);
    const targetRank = this.getRoleRank(targetRole, roleMap);

    if (targetRank > actorRank) {
      return false;
    }

    if (targetRank === actorRank && actorRole !== 'ADMIN') {
      return false;
    }

    return true;
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
    const grantablePermissions = Array.from(
      new Set([...actorPermissions, ...this.getRoleDefaultPermissions(actorRole, roleMap)]),
    );

    if (grantablePermissions.includes('*') || grantablePermissions.includes('ALL')) {
      return true;
    }

    return targetPermissions
      .filter((permission) => !GRANT_EXEMPT_PERMISSION_IDS.includes(permission))
      .every((permission) => grantablePermissions.includes(permission));
  }

  hasPermission(actor: ActorContext, permission: string): boolean {
    return (
      actor.permissions.includes('*') ||
      actor.permissions.includes('ALL') ||
      actor.permissions.includes(permission)
    );
  }

  ensureActor(actor?: ActorContext): ActorContext {
    if (!actor?.username) {
      throw new ForbiddenException('ไม่ได้เข้าสู่ระบบ');
    }

    return actor;
  }

  resolveEffectivePermissions(
    role: string,
    permissions: unknown,
    roleMap?: Map<string, RoleDefinition>,
  ): string[] {
    const storedPermissions = this.normalizePermissionList(permissions);
    if (storedPermissions.length > 0) {
      return storedPermissions;
    }

    return this.getRoleDefaultPermissions(role, roleMap);
  }

  assertCanCreateTask(actor: ActorContext, taskType: string): void {
    if (taskType === 'LOGIN') {
      const canCreateLoginLink =
        this.hasPermission(actor, 'login-links') && this.hasPermission(actor, 'create');

      if (!canCreateLoginLink) {
        throw new ForbiddenException('ไม่มีสิทธิ์สร้างลิงก์เข้าสู่ระบบ');
      }

      return;
    }

    if (!this.hasPermission(actor, 'create')) {
      throw new ForbiddenException('ไม่มีสิทธิ์สร้างรายการนี้');
    }
  }

  async assertAssignableLoginPayload(
    actor: ActorContext,
    data: unknown,
    roleMap?: Map<string, RoleDefinition>,
  ): Promise<void> {
    const currentRoleMap = roleMap || (await this.getRoleMap());
    const actorRole = this.getPrimaryRole({ roles: actor.roles });
    const requestedRole = this.normalizeRole(data);
    const actorRank = this.getRoleRank(actorRole, currentRoleMap);
    const requestedRank = this.getRoleRank(requestedRole, currentRoleMap);
    const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

    if (requestedRank === 0) {
      throw new ForbiddenException(`ไม่สามารถกำหนดตำแหน่ง ${requestedRole} ได้`);
    }

    if (requestedRank > actorRank || (requestedRank === actorRank && actorRole !== 'ADMIN')) {
      throw new ForbiddenException('ไม่สามารถกำหนดตำแหน่งสูงกว่าหรือเทียบเท่าตำแหน่งของตนเองได้');
    }

    const requestedPermissions = this.normalizePermissionList(
      payload.permissions ?? payload.mock_permissions,
    );
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

    if (!this.isScopeSubsetOfActor(payload.data_scope, actor.data_scope)) {
      throw new ForbiddenException('ไม่สามารถกำหนดขอบเขตข้อมูลกว้างกว่าสิทธิ์ของตนเองได้');
    }

    const roleScopeError = getRoleScopeValidationError(requestedRole, payload.data_scope, {
      scopeMode: this.getRoleScopeMode(requestedRole, currentRoleMap),
      scopePolicy: this.getRoleScopePolicy(requestedRole, currentRoleMap),
      roleLabel: this.getRoleLabel(requestedRole, currentRoleMap),
    });
    if (roleScopeError) {
      throw new ForbiddenException(roleScopeError);
    }
  }

  canManageLoginLink(
    actor: ActorContext,
    link: {
      login_role?: string | null;
      login_data_scope?: unknown;
    },
    roleMap?: Map<string, RoleDefinition>,
  ): boolean {
    const actorRole = this.getPrimaryRole({ roles: actor.roles });
    const targetRole =
      typeof link.login_role === 'string' && link.login_role.trim().length > 0
        ? link.login_role.trim()
        : 'TEACHER';

    if (!this.canManageRole(actorRole, targetRole, roleMap)) {
      return false;
    }

    return this.isScopeSubsetOfActor(link.login_data_scope, actor.data_scope);
  }

  private normalizeLinkScopeValue(value: unknown): string | number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return undefined;
  }

  private buildManagedTaskLinkScope(link: {
    target_school_id?: unknown;
    target_room?: unknown;
  }): DataScope | undefined {
    const targetSchoolId = this.normalizeLinkScopeValue(link.target_school_id);
    const targetRoom = this.normalizeLinkScopeValue(link.target_room);
    const scope: DataScope = {};

    if (targetSchoolId !== undefined) {
      scope.school_ids = [targetSchoolId];
    }

    if (targetRoom !== undefined) {
      scope.room_ids = [targetRoom];
    }

    return Object.keys(scope).length > 0 ? scope : undefined;
  }

  canManageAdminLink(
    actor: ActorContext,
    link: {
      task_type?: string | null;
      login_role?: string | null;
      login_data_scope?: unknown;
      target_school_id?: unknown;
      target_room?: unknown;
    },
    roleMap?: Map<string, RoleDefinition>,
  ): boolean {
    const taskType = typeof link.task_type === 'string' ? link.task_type.trim() : '';

    if (taskType === 'LOGIN') {
      return (
        this.hasPermission(actor, 'login-links') && this.canManageLoginLink(actor, link, roleMap)
      );
    }

    if (taskType === 'ATTENDANCE') {
      if (!this.hasPermission(actor, 'attendance-dashboard')) {
        return false;
      }

      const scope = this.buildManagedTaskLinkScope(link);
      return scope ? this.isScopeSubsetOfActor(scope, actor.data_scope) : true;
    }

    if (taskType === 'VISIT') {
      if (!this.hasPermission(actor, 'dashboard')) {
        return false;
      }

      const scope = this.buildManagedTaskLinkScope(link);
      return scope ? this.isScopeSubsetOfActor(scope, actor.data_scope) : true;
    }

    return false;
  }
}

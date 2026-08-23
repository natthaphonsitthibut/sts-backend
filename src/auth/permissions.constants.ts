import { normalizeScopeArray, type DataScope } from './auth.types';
import { GRANTABLE_PAGE_PERMISSIONS, NON_PAGE_PERMISSIONS } from './page-registry.constants';

export type RoleScopeMode =
  | 'flexible'
  | 'global'
  | 'province'
  | 'district'
  | 'sub_district'
  | 'school';

export type RoleScopePolicy = 'ASSIGNABLE' | 'OWN_ONLY';

export interface SystemRoleDefinition {
  name: string;
  label: string;
  default_permissions: string[];
  scope_mode: RoleScopeMode;
  scope_policy: RoleScopePolicy;
  is_assignable: boolean;
  is_system: boolean;
}

interface PermissionMenuItem {
  id: string;
  label: string;
  children?: PermissionMenuItem[];
}

/**
 * Built from the page registry rather than written by hand: one permission per
 * page, labelled with that page's own title, grouped the way the sidebar groups
 * it. The frontend fetches this (GET /users/permissions) instead of keeping its
 * own list, so what an operator ticks always reads like the menu they are
 * granting.
 */
function buildPermissionMenu(): PermissionMenuItem[] {
  const items: PermissionMenuItem[] = [];
  const groups = new Map<string, PermissionMenuItem>();

  for (const page of GRANTABLE_PAGE_PERMISSIONS) {
    const entry = { id: page.id, label: page.title };
    if (!page.group) {
      items.push(entry);
      continue;
    }
    let group = groups.get(page.group);
    if (!group) {
      group = { id: `group:${page.group}`, label: page.group, children: [] };
      groups.set(page.group, group);
      items.push(group);
    }
    group.children!.push(entry);
  }

  return [...items, ...NON_PAGE_PERMISSIONS.map((item) => ({ id: item.id, label: item.title }))];
}

export const PERMISSION_MENU_ITEMS: PermissionMenuItem[] = buildPermissionMenu();

function collectLeafPermissions(items: PermissionMenuItem[]): Array<{ id: string; label: string }> {
  return items.flatMap((item) =>
    item.children && item.children.length > 0
      ? collectLeafPermissions(item.children)
      : [{ id: item.id, label: item.label }],
  );
}

/** Flat catalog of grantable permissions with Thai labels (leaves only). */
export const PERMISSION_CATALOG = collectLeafPermissions(PERMISSION_MENU_ITEMS);

export const VALID_PERMISSION_IDS = PERMISSION_CATALOG.map((item) => item.id);

// Where each retired permission ended up when the catalog collapsed to one
// permission per page (2026-08-17) is recorded — and executed — by migration
// 20260821090000-CollapsePermissionsToPages. Keeping a second copy here as an
// exported constant nothing reads would only give the two a way to disagree.

const ADMIN_DEFAULT_PERMISSIONS = VALID_PERMISSION_IDS;

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  {
    name: 'ADMIN',
    label: 'ผู้ดูแลระบบ',
    default_permissions: ADMIN_DEFAULT_PERMISSIONS,
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    name: 'DIRECTOR',
    label: 'ผู้อำนวยการ',
    // Every page a director works in. The retired action-level ids
    // (edit-students, close-case, manage-timetable, …) are covered by the page
    // they lived on — see 20260821090000-CollapsePermissionsToPages.
    default_permissions: [
      'home',
      'dashboard',
      'students',
      'classrooms',
      'attendance',
      'attendance-dashboard',
      'manage-classroom-links',
      'manage-school-structure',
      'manage-subjects',
      'import-data',
      'export-data',
      'manage-users-list',
      'manage-teachers',
      'settings',
      'audit-log',
    ],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    name: 'EXECUTIVE',
    label: 'ผู้บริหาร',
    default_permissions: ['home'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
];

export const ROLE_BASELINES: Record<string, string[]> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.default_permissions]),
);

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.label]),
);

export const ROLE_SCOPE_MODES: Record<string, RoleScopeMode> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.scope_mode]),
);

export function getRoleScopeValidationError(
  role: string,
  scope: unknown,
  options?: {
    scopeMode?: RoleScopeMode | null;
    scopePolicy?: RoleScopePolicy | null;
    roleLabel?: string | null;
  },
): string | null {
  const source = scope && typeof scope === 'object' ? (scope as DataScope) : {};
  const normalized = {
    global: source.global === true,
    provinces: normalizeScopeArray(source.provinces),
    districts: normalizeScopeArray(source.districts),
    sub_districts: normalizeScopeArray(source.sub_districts),
    school_ids: normalizeScopeArray(source.school_ids),
    grade_levels: normalizeScopeArray(source.grade_levels),
    room_ids: normalizeScopeArray(source.room_ids),
  };

  const hasExtraSchoolFiltering =
    normalized.grade_levels.length > 0 || normalized.room_ids.length > 0;
  const scopeMode = options?.scopeMode || ROLE_SCOPE_MODES[role] || 'flexible';
  const roleLabel = options?.roleLabel || ROLE_LABELS[role] || role;
  const scopePolicy = options?.scopePolicy || 'ASSIGNABLE';

  if (scopePolicy === 'OWN_ONLY') {
    return source.own_only === true ? null : `${roleLabel}ต้องใช้ขอบเขตข้อมูลเฉพาะตนเอง`;
  }

  if (scopeMode === 'flexible') {
    const hasAreaScope =
      normalized.provinces.length > 0 ||
      normalized.districts.length > 0 ||
      normalized.sub_districts.length > 0 ||
      normalized.school_ids.length > 0 ||
      hasExtraSchoolFiltering;
    // Empty flexible scope = nationwide (valid). "ทุกจังหวัด/ทุกอำเภอ..." left
    // unselected means no narrowing at that level, so leaving them all empty is
    // country-wide. The UI adds an explicit confirm before saving a nationwide
    // account, and a scoped admin still cannot assign broader-than-self scope
    // (enforced by isScopeSubsetOfActor).
    if (normalized.global && hasAreaScope) {
      return `${roleLabel}ห้ามเลือกทั้งระบบพร้อมกับพื้นที่`;
    }
    return source.own_only === true ? `${roleLabel}ไม่สามารถใช้ขอบเขตเฉพาะตนเองได้` : null;
  }

  if (scopeMode === 'global') {
    const hasAnyScope =
      normalized.provinces.length > 0 ||
      normalized.districts.length > 0 ||
      normalized.sub_districts.length > 0 ||
      normalized.school_ids.length > 0 ||
      hasExtraSchoolFiltering;

    return hasAnyScope ? `${roleLabel}ต้องใช้ขอบเขตข้อมูลระดับประเทศเท่านั้น` : null;
  }

  if (scopeMode === 'province') {
    if (normalized.provinces.length !== 1) {
      return `${roleLabel}ต้องเลือกจังหวัด 1 แห่ง`;
    }
    if (
      normalized.districts.length > 0 ||
      normalized.sub_districts.length > 0 ||
      normalized.school_ids.length > 0 ||
      hasExtraSchoolFiltering
    ) {
      return `${roleLabel}ห้ามจำกัดอำเภอ ตำบล โรงเรียน ชั้น หรือห้อง`;
    }
  }

  if (scopeMode === 'district') {
    if (normalized.provinces.length !== 1 || normalized.districts.length !== 1) {
      return `${roleLabel}ต้องเลือกจังหวัดและอำเภออย่างละ 1 รายการ`;
    }
    if (
      normalized.sub_districts.length > 0 ||
      normalized.school_ids.length > 0 ||
      hasExtraSchoolFiltering
    ) {
      return `${roleLabel}ห้ามจำกัดตำบล โรงเรียน ชั้น หรือห้อง`;
    }
  }

  if (scopeMode === 'sub_district') {
    if (
      normalized.provinces.length !== 1 ||
      normalized.districts.length !== 1 ||
      normalized.sub_districts.length !== 1
    ) {
      return `${roleLabel}ต้องเลือกจังหวัด อำเภอ และตำบลอย่างละ 1 รายการ`;
    }
    if (normalized.school_ids.length > 0 || hasExtraSchoolFiltering) {
      return `${roleLabel}ห้ามจำกัดโรงเรียน ชั้น หรือห้อง`;
    }
  }

  if (scopeMode === 'school') {
    if (
      normalized.provinces.length !== 1 ||
      normalized.districts.length !== 1 ||
      normalized.sub_districts.length !== 1 ||
      normalized.school_ids.length !== 1
    ) {
      return `${roleLabel}ต้องเลือกจังหวัด อำเภอ ตำบล และโรงเรียนอย่างละ 1 รายการ`;
    }
    if (hasExtraSchoolFiltering) {
      return `${roleLabel}ห้ามจำกัดระดับชั้นหรือห้องเรียน`;
    }
  }

  return null;
}

export function getEffectivePermissions(
  roles: string[],
  customPermissions: string[] = [],
): string[] {
  void roles;
  return Array.from(new Set(customPermissions));
}

/**
 * Which pages an actor may open is what its menu group grants — the role name
 * decides nothing on its own.
 *
 * ผู้บริหาร used to be clamped here to หน้าหลัก whatever its group said, which
 * made the group's own ticks a lie: after the page collapse the role carries
 * `home` and `ตารางสอน`, the sidebar showed both, and every timetable request
 * came back 403. The rule that actually matters for that role — it never reads a
 * student's raw text — is not a page permission and is enforced where the raw
 * data is read (`isRestrictedExecutive` in students, task, case and data-export
 * services). Granting ผู้บริหาร a page therefore grants the page, not the text.
 */
export function hasPermission(
  roles: string[],
  customPermissions: string[],
  permission: string,
): boolean {
  if (customPermissions.includes('*') || customPermissions.includes('ALL')) return true;
  const effectivePermissions = getEffectivePermissions(roles, customPermissions);
  return effectivePermissions.includes(permission);
}

/** Executive-only actors stay restricted even if a raw-data permission is re-granted. */
export function isRestrictedExecutive(actor: { roles: string[] } | undefined): boolean {
  return Boolean(
    actor?.roles.includes('EXECUTIVE') &&
    !actor.roles.some((role) => role === 'ADMIN' || role === 'DIRECTOR'),
  );
}

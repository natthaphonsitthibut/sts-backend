import type { DataScope } from './auth.types';

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
  rank: number;
  default_permissions: string[];
  scope_mode: RoleScopeMode;
  scope_policy: RoleScopePolicy;
  is_assignable: boolean;
  is_system: boolean;
}

interface PermissionMenuItem {
  id: string;
  children?: PermissionMenuItem[];
}

export const PERMISSION_MENU_ITEMS: PermissionMenuItem[] = [
  { id: 'home' },
  { id: 'dashboard' },
  { id: 'students' },
  {
    id: 'case-management',
    children: [{ id: 'review-cases' }, { id: 'close-case' }, { id: 'forward-case' }],
  },
  { id: 'student-self' },
  { id: 'create' },
  { id: 'import-data' },
  {
    id: 'attendance-system',
    children: [{ id: 'attendance-dashboard' }, { id: 'attendance' }],
  },
  {
    id: 'manage-users',
    children: [
      { id: 'manage-users-list' },
      { id: 'manage-student-accounts' },
      { id: 'manage-role-groups' },
      { id: 'login-links' },
    ],
  },
  { id: 'settings' },
  { id: 'audit-log' },
];

function collectLeafPermissionIds(items: PermissionMenuItem[]): string[] {
  return items.flatMap((item) =>
    item.children && item.children.length > 0 ? collectLeafPermissionIds(item.children) : [item.id],
  );
}

export const VALID_PERMISSION_IDS = collectLeafPermissionIds(PERMISSION_MENU_ITEMS);

export const GRANT_EXEMPT_PERMISSION_IDS = ['student-self'];

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  {
    name: 'ADMIN',
    label: 'ผู้ดูแลระบบ',
    rank: 5,
    default_permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'manage-student-accounts',
      'manage-role-groups',
      'login-links',
      'settings',
      'import-data',
      'audit-log',
    ],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    name: 'DIRECTOR',
    label: 'ผู้อำนวยการ',
    rank: 4,
    default_permissions: [
      'home',
      'dashboard',
      'students',
      'review-cases',
      'close-case',
      'forward-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
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
    rank: 3,
    default_permissions: ['home', 'dashboard', 'students', 'review-cases', 'attendance-dashboard'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    name: 'TEACHER',
    label: 'คุณครู',
    rank: 2,
    default_permissions: ['home', 'students', 'attendance'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    name: 'STUDENT',
    label: 'นักเรียน',
    rank: 1,
    default_permissions: ['home', 'student-self'],
    scope_mode: 'flexible',
    scope_policy: 'OWN_ONLY',
    is_assignable: true,
    is_system: true,
  },
];

export const ROLE_RANKS: Record<string, number> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.rank]),
);

export const ROLE_BASELINES: Record<string, string[]> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.default_permissions]),
);

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.label]),
);

export const ROLE_SCOPE_MODES: Record<string, RoleScopeMode> = Object.fromEntries(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.name, role.scope_mode]),
);

function normalizeScopeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
  );
}

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
    const hasAssignedScope = normalized.global || hasAreaScope;
    if (!hasAssignedScope) {
      return `${roleLabel}ต้องเลือกขอบเขตข้อมูล หรือเลือกทั้งระบบ`;
    }
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

export function hasPermission(
  roles: string[],
  customPermissions: string[],
  permission: string,
): boolean {
  if (customPermissions.includes('*') || customPermissions.includes('ALL')) return true;
  const effectivePermissions = getEffectivePermissions(roles, customPermissions);
  return effectivePermissions.includes(permission);
}

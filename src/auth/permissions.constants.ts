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
  label: string;
  children?: PermissionMenuItem[];
}

// Canonical permission tree — the single source of truth for both the valid
// permission ids and their Thai labels. The frontend fetches this (GET
// /users/permissions) instead of hardcoding its own list, so the checkbox
// editor and review dialog never drift from what the backend accepts.
export const PERMISSION_MENU_ITEMS: PermissionMenuItem[] = [
  { id: 'home', label: 'หน้าหลัก' },
  { id: 'dashboard', label: 'รายงานนักเรียน' },
  { id: 'students', label: 'รายชื่อนักเรียน' },
  { id: 'edit-students', label: 'แก้ไขข้อมูลนักเรียน' },
  {
    id: 'case-management',
    label: 'จัดการเคสติดตามนักเรียน',
    children: [
      { id: 'review-cases', label: 'ดูเคสติดตามนักเรียน' },
      { id: 'assign-follow-up-cases', label: 'มอบหมายผู้ติดตามเคสในโรงเรียน' },
      { id: 'close-case', label: 'ปิดเคส' },
    ],
  },
  { id: 'create', label: 'สร้างลิงก์' },
  { id: 'import-data', label: 'นำเข้าข้อมูล' },
  { id: 'export-data', label: 'ส่งออกข้อมูล' },
  {
    id: 'attendance-system',
    label: 'ระบบเช็คชื่อ',
    children: [
      { id: 'attendance-dashboard', label: 'ลิงก์เช็คชื่อ' },
      { id: 'attendance', label: 'เช็คชื่อ' },
      { id: 'manage-attendance-calendar', label: 'จัดการปฏิทินเช็คชื่อ' },
      { id: 'manage-timetable', label: 'จัดการตารางสอน' },
    ],
  },
  {
    id: 'manage-users',
    label: 'จัดการสิทธิ์ผู้ใช้งาน',
    children: [
      { id: 'manage-users-list', label: 'จัดการรายชื่อผู้ใช้งาน' },
      { id: 'manage-users-hard-delete', label: 'ลบบัญชีถาวร' },
      { id: 'manage-role-groups', label: 'จัดการกลุ่มเมนู' },
    ],
  },
  { id: 'manage-schools', label: 'จัดการข้อมูลโรงเรียน' },
  { id: 'manage-school-structure', label: 'จัดการภาคเรียน ห้อง และครู' },
  { id: 'student-observations', label: 'บันทึกและดูข้อสังเกตนักเรียนที่รับผิดชอบ' },
  { id: 'manage-student-observations', label: 'จัดการข้อสังเกตนักเรียนในโรงเรียน' },
  { id: 'import-school-roster', label: 'นำเข้าครูและนักเรียนของโรงเรียน' },
  { id: 'settings', label: 'ตั้งค่าระบบ' },
  { id: 'audit-log', label: 'บันทึกการใช้งาน' },
  { id: 'field-monitor', label: 'ติดตามภาคสนาม' },
];

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

export const GRANT_EXEMPT_PERMISSION_IDS = ['student-self'];

const ADMIN_DEFAULT_PERMISSIONS = VALID_PERMISSION_IDS;

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  {
    name: 'ADMIN',
    label: 'ผู้ดูแลระบบ',
    rank: 5,
    default_permissions: ADMIN_DEFAULT_PERMISSIONS,
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
      'edit-students',
      'review-cases',
      'assign-follow-up-cases',
      'close-case',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-attendance-calendar',
      'manage-timetable',
      'manage-users-list',
      'manage-schools',
      'manage-school-structure',
      'manage-student-observations',
      'import-school-roster',
      'settings',
      'export-data',
      'audit-log',
      'field-monitor',
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
    default_permissions: ['home'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    name: 'TEACHER',
    label: 'คุณครู',
    rank: 2,
    default_permissions: ['home', 'students', 'attendance', 'student-observations'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
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

const EXECUTIVE_ALLOWED_PERMISSIONS = new Set(['home']);

export function hasPermission(
  roles: string[],
  customPermissions: string[],
  permission: string,
): boolean {
  if (isRestrictedExecutive({ roles }) && !EXECUTIVE_ALLOWED_PERMISSIONS.has(permission)) {
    return false;
  }
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

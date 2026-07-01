import type { DataSource } from 'typeorm';

const LEGACY_ADMIN_ROLES = new Set([
  'ADMIN_PROVINCE',
  'ADMIN_DISTRICT',
  'ADMIN_SUBDISTRICT',
  'ADMIN_SCHOOL',
]);
const AUDIT_LOG_PERMISSION_MIGRATION = 'GrantAuditLogPermission20260630140000';

type JsonRecord = Record<string, unknown>;

export interface RoleScopeParityRow extends Record<string, unknown> {
  user_id: number;
  old_role: string | null;
  old_permissions: unknown;
  old_data_scope: unknown;
  current_role: string | null;
  current_permissions: unknown;
  current_data_scope: unknown;
  old_role_defaults: unknown;
  current_role_defaults: unknown;
}

export interface RoleScopeParityFinding {
  userId: number;
  issues: string[];
}

export interface RoleScopeParityOptions {
  appliedMigrations?: ReadonlySet<string>;
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return normalizeStringList(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter(
          (item): item is string | number => typeof item === 'string' || typeof item === 'number',
        )
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function effectivePermissions(stored: unknown, defaults: unknown): string[] {
  const storedPermissions = normalizeStringList(stored);
  return storedPermissions.length > 0 ? storedPermissions : normalizeStringList(defaults);
}

function normalizeScope(value: unknown): JsonRecord {
  const source = asRecord(value);
  const normalized: JsonRecord = {};
  for (const [key, item] of Object.entries(source).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (item === true) {
      normalized[key] = true;
      continue;
    }
    const values = normalizeStringList(item);
    if (values.length > 0) {
      normalized[key] = values;
    }
  }
  return normalized;
}

function expectedRole(oldRole: string | null): string | null {
  return oldRole && LEGACY_ADMIN_ROLES.has(oldRole) ? 'ADMIN' : oldRole;
}

function expectedScope(oldRole: string | null, oldScopeValue: unknown): JsonRecord {
  const oldScope = asRecord(oldScopeValue);
  if (oldRole === 'STUDENT') {
    const { global: _global, ...rest } = oldScope;
    void _global;
    return normalizeScope({ ...rest, own_only: true });
  }
  if (Object.keys(oldScope).length === 0) {
    return { global: true };
  }
  return normalizeScope(oldScope);
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function changedScopeKeys(expected: JsonRecord, current: JsonRecord): string[] {
  const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(current)])).sort();
  return keys.filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(current[key]));
}

export function compareRoleScopeParity(
  row: RoleScopeParityRow,
  options: RoleScopeParityOptions = {},
): RoleScopeParityFinding | null {
  const issues: string[] = [];
  const expectedCurrentRole = expectedRole(row.old_role);
  if (!row.current_role) {
    issues.push('current user missing');
  } else if (row.current_role !== expectedCurrentRole) {
    issues.push(`role expected=${expectedCurrentRole ?? 'NULL'} current=${row.current_role}`);
  }

  const beforePermissions = effectivePermissions(row.old_permissions, row.old_role_defaults);
  const expectedPermissions = new Set(beforePermissions);
  if (
    options.appliedMigrations?.has(AUDIT_LOG_PERMISSION_MIGRATION) &&
    (expectedCurrentRole === 'ADMIN' || expectedCurrentRole === 'DIRECTOR')
  ) {
    expectedPermissions.add('audit-log');
  }
  const afterPermissions = effectivePermissions(row.current_permissions, row.current_role_defaults);
  const expectedPermissionList = Array.from(expectedPermissions).sort();
  const addedPermissions = difference(afterPermissions, expectedPermissionList);
  const removedPermissions = difference(expectedPermissionList, afterPermissions);
  if (addedPermissions.length > 0) {
    issues.push(`permissions added=${addedPermissions.join(',')}`);
  }
  if (removedPermissions.length > 0) {
    issues.push(`permissions removed=${removedPermissions.join(',')}`);
  }

  const expectedCurrentScope = expectedScope(row.old_role, row.old_data_scope);
  const currentScope = normalizeScope(row.current_data_scope);
  const scopeKeys = changedScopeKeys(expectedCurrentScope, currentScope);
  if (scopeKeys.length > 0) {
    issues.push(`scope mismatch keys=${scopeKeys.join(',')}`);
  }

  return issues.length > 0 ? { userId: Number(row.user_id), issues } : null;
}

async function loadParityRows(dataSource: DataSource): Promise<RoleScopeParityRow[]> {
  const rawTableRows: unknown = await dataSource.query(
    `SELECT to_regclass('public.user_role_scope_migration_backup') AS table_name`,
  );
  const tableRows = Array.isArray(rawTableRows)
    ? (rawTableRows as Array<{ table_name?: unknown }>)
    : [];
  if (!tableRows[0]?.table_name) {
    throw new Error('user_role_scope_migration_backup is missing; migration 33 is not ready');
  }

  const rawRows: unknown = await dataSource.query(`
    SELECT
      backup.user_id,
      backup.old_role,
      backup.old_permissions,
      backup.old_data_scope,
      user_row.role AS current_role,
      user_row.permissions AS current_permissions,
      user_row.data_scope AS current_data_scope,
      old_role_row.default_permissions AS old_role_defaults,
      current_role_row.default_permissions AS current_role_defaults
    FROM user_role_scope_migration_backup backup
    LEFT JOIN users user_row ON user_row.id = backup.user_id
    LEFT JOIN roles old_role_row ON old_role_row.name = backup.old_role
    LEFT JOIN roles current_role_row ON current_role_row.name = user_row.role
    ORDER BY backup.user_id
  `);
  if (!Array.isArray(rawRows)) {
    throw new Error('Role/scope parity query returned an invalid result');
  }
  return rawRows as RoleScopeParityRow[];
}

async function loadAppliedMigrationNames(dataSource: DataSource): Promise<Set<string>> {
  const rawRows: unknown = await dataSource.query(`SELECT name FROM migrations`);
  if (!Array.isArray(rawRows)) {
    throw new Error('Migration history query returned an invalid result');
  }
  return new Set(
    (rawRows as Array<{ name?: unknown }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string'),
  );
}

async function main(): Promise<void> {
  const { default: dataSource } = await import('../database/typeorm.datasource');
  await dataSource.initialize();
  try {
    const [rows, appliedMigrations] = await Promise.all([
      loadParityRows(dataSource),
      loadAppliedMigrationNames(dataSource),
    ]);
    const findings = rows
      .map((row) => compareRoleScopeParity(row, { appliedMigrations }))
      .filter((finding): finding is RoleScopeParityFinding => finding !== null);

    console.log(`Role/scope migration parity checked: ${rows.length} affected users.`);
    if (findings.length === 0) {
      console.log('Per-user role, effective permissions, and data scope parity verified.');
      return;
    }

    for (const finding of findings) {
      console.error(`User ${finding.userId}: ${finding.issues.join('; ')}`);
    }
    throw new Error(`Role/scope migration parity failed for ${findings.length} users`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Role/scope parity check failed');
    process.exitCode = 1;
  });
}

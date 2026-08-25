const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const {
  PERMISSION_CATALOG,
  SYSTEM_ROLE_DEFINITIONS,
  VALID_PERMISSION_IDS,
  getRoleScopeValidationError,
} = require('../dist/auth/permissions.constants');
const { APP_PAGES } = require('../dist/auth/page-registry.constants');
const { isUnconfiguredDataScope } = require('../dist/auth/auth.types');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run permission registry audit with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function normalizedStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function sameSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);

  try {
    const [roles, users] = await Promise.all([
      dataSource.query(
        `SELECT name, default_permissions, scope_mode, scope_policy, is_assignable,
                is_system, school_id
         FROM roles ORDER BY name`,
      ),
      dataSource.query(
        `SELECT id, username, role, permissions, data_scope, status, data_origin_code
         FROM users ORDER BY id`,
      ),
    ]);
    const valid = new Set(VALID_PERMISSION_IDS);
    const roleByName = new Map(roles.map((role) => [role.name, role]));
    const pageIds = APP_PAGES.map((page) => page.id);
    const catalogIds = PERMISSION_CATALOG.map((permission) => permission.id);
    const roleInvalidPermissions = [];
    const roleDuplicatePermissions = [];
    const userInvalidPermissions = [];
    const userDuplicatePermissions = [];
    const missingUserRoles = [];
    const malformedActiveScopes = [];
    const systemRoleDrift = [];

    for (const role of roles) {
      const permissions = normalizedStrings(role.default_permissions);
      const invalid = permissions.filter((permission) => !valid.has(permission));
      if (invalid.length > 0) roleInvalidPermissions.push({ role: role.name, invalid });
      if (new Set(permissions).size !== permissions.length) {
        roleDuplicatePermissions.push(role.name);
      }
    }

    for (const expected of SYSTEM_ROLE_DEFINITIONS) {
      const actual = roleByName.get(expected.name);
      if (
        !actual ||
        actual.is_system !== true ||
        actual.scope_mode !== expected.scope_mode ||
        actual.scope_policy !== expected.scope_policy ||
        actual.is_assignable !== expected.is_assignable ||
        !sameSet(normalizedStrings(actual.default_permissions), expected.default_permissions)
      ) {
        systemRoleDrift.push(expected.name);
      }
    }

    for (const user of users) {
      const role = roleByName.get(user.role);
      if (user.role && !role) missingUserRoles.push(user.id);
      if (Array.isArray(user.permissions)) {
        const permissions = normalizedStrings(user.permissions);
        const invalid = permissions.filter((permission) => !valid.has(permission));
        if (invalid.length > 0) userInvalidPermissions.push({ userId: user.id, invalid });
        if (new Set(permissions).size !== permissions.length) userDuplicatePermissions.push(user.id);
      }
      if (user.status !== 'ACTIVE' || user.data_origin_code === 'AUTOMATED_TEST' || !role) continue;
      const scopeError = getRoleScopeValidationError(user.role, user.data_scope, {
        scopeMode: role.scope_mode,
        scopePolicy: role.scope_policy,
        roleLabel: role.name,
      });
      const schoolIds = Array.isArray(user.data_scope?.school_ids)
        ? user.data_scope.school_ids.map(Number).filter(Number.isInteger)
        : [];
      const customSchoolMismatch =
        role.school_id != null &&
        (user.data_scope?.global === true || schoolIds.length !== 1 || schoolIds[0] !== role.school_id);
      if (scopeError || isUnconfiguredDataScope(user.data_scope) || customSchoolMismatch) {
        malformedActiveScopes.push({
          userId: user.id,
          reason: scopeError || (customSchoolMismatch ? 'custom role school mismatch' : 'unconfigured'),
        });
      }
    }

    const systemPermissionCoverage = new Set(
      roles
        .filter((role) => role.is_system === true)
        .flatMap((role) => normalizedStrings(role.default_permissions)),
    );
    const uncoveredPermissions = VALID_PERMISSION_IDS.filter(
      (permission) => !systemPermissionCoverage.has(permission),
    );
    const masterDataPage = APP_PAGES.find((page) => page.id === 'master-data');
    const result = {
      status: 'permission_registry_audit',
      page_id_duplicates: pageIds.length - new Set(pageIds).size,
      catalog_id_duplicates: catalogIds.length - new Set(catalogIds).size,
      uncovered_permissions: uncoveredPermissions.length,
      role_invalid_permissions: roleInvalidPermissions.length,
      role_duplicate_permissions: roleDuplicatePermissions.length,
      user_invalid_permissions: userInvalidPermissions.length,
      user_duplicate_permissions: userDuplicatePermissions.length,
      missing_user_roles: missingUserRoles.length,
      malformed_active_scopes: malformedActiveScopes.length,
      system_role_drift: systemRoleDrift.length,
      master_data_policy_issues:
        masterDataPage?.scopePolicy === 'global-only' && valid.has('master-data') ? 0 : 1,
    };
    console.log(JSON.stringify(result));
    const failures = Object.entries(result).filter(
      ([key, value]) => key !== 'status' && Number(value) !== 0,
    );
    if (failures.length > 0) {
      const detail = {
        roleInvalidPermissions,
        roleDuplicatePermissions,
        userInvalidPermissions,
        userDuplicatePermissions,
        missingUserRoles,
        malformedActiveScopes,
        systemRoleDrift,
        uncoveredPermissions,
      };
      throw new Error(
        `Permission registry audit failed: ${failures
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')} ${JSON.stringify(detail)}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

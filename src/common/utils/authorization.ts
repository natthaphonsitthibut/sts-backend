import type { DataScope } from '../../auth/auth.types';

export type { DataScope };
export { ROLE_BASELINES } from '../../auth/permissions.constants';

export function buildDataScopeQuery(
  scope: DataScope,
  tableAliases: {
    school_id?: string;
    province?: string;
    district?: string;
    sub_district?: string;
    grade?: string;
    room?: string;
  } = {},
  startIndex = 1,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startIndex;

  const schoolAlias = tableAliases.school_id || 'school_id';
  const provinceAlias = tableAliases.province || 'province';
  const districtAlias = tableAliases.district || 'district';
  const subDistrictAlias = tableAliases.sub_district || 'sub_district';
  const gradeAlias = tableAliases.grade || 'grade_level_id';
  const roomAlias = tableAliases.room || 'room_id';

  if (scope.school_ids && scope.school_ids.length > 0) {
    clauses.push(`${schoolAlias} = ANY($${paramIndex++}::int[])`);
    params.push(scope.school_ids);
  }

  if (scope.provinces && scope.provinces.length > 0) {
    clauses.push(`${provinceAlias} = ANY($${paramIndex++}::text[])`);
    params.push(scope.provinces);
  }

  if (scope.districts && scope.districts.length > 0) {
    clauses.push(`${districtAlias} = ANY($${paramIndex++}::text[])`);
    params.push(scope.districts);
  }

  if (scope.sub_districts && scope.sub_districts.length > 0) {
    clauses.push(`${subDistrictAlias} = ANY($${paramIndex++}::text[])`);
    params.push(scope.sub_districts);
  }

  if (scope.grade_levels && scope.grade_levels.length > 0) {
    clauses.push(`${gradeAlias} = ANY($${paramIndex++}::int[])`);
    params.push(scope.grade_levels);
  }

  if (scope.room_ids && scope.room_ids.length > 0) {
    clauses.push(`${roomAlias} = ANY($${paramIndex++}::text[])`);
    params.push(scope.room_ids);
  }

  if (clauses.length === 0) {
    // No area clause. Nationwide must be an explicit intent (global:true), and
    // own_only scopes are gated at the service layer — both keep the legacy
    // "no filter" behaviour. Anything else is an unconfigured/corrupt scope:
    // fail closed (0 rows) instead of silently exposing the whole country.
    if (scope.global === true || scope.own_only === true) {
      return { sql: '', params: [] };
    }
    return { sql: '1=0', params: [] };
  }

  return { sql: clauses.join(' AND '), params };
}

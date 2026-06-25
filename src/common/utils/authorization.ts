import type { DataScope } from '../../auth/auth.types';
import { normalizeDataScope } from '../../auth/auth.types';

export type { DataScope };

export function parseScopeHeader(scopeHeader?: string): DataScope | undefined {
  if (!scopeHeader) {
    return undefined;
  }

  const candidates: string[] = [];

  if (scopeHeader.startsWith('uri:')) {
    try {
      candidates.push(decodeURIComponent(scopeHeader.slice(4)));
    } catch {
      // Fall back to raw parsing below.
    }
  }

  candidates.push(scopeHeader);

  for (const candidate of candidates) {
    try {
      const parsed = normalizeDataScope(JSON.parse(candidate));
      if (parsed) {
        return parsed;
      }
    } catch {
      // Try the next format.
    }
  }

  return undefined;
}

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
    return { sql: '', params: [] };
  }

  return { sql: clauses.join(' AND '), params };
}

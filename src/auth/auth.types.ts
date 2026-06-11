import type { Request } from 'express';

export interface DataScope {
  provinces?: string[];
  districts?: string[];
  sub_districts?: string[];
  school_ids?: Array<number | string>;
  grade_levels?: Array<number | string>;
  room_ids?: Array<number | string>;
  own_only?: boolean;
}

export interface AuthenticatedRequestUser {
  id: number;
  username: string;
  roles: string[];
  permissions: string[];
  data_scope?: DataScope;
  virtual_login?: boolean;
  PersonID_Onec?: string;
  FirstName?: string | null;
  LastName?: string | null;
  affiliation?: string | null;
  auth_source?: 'LOCAL' | 'MAGIC_LINK' | 'THAID_MOCK';
}

export type ActorContext = AuthenticatedRequestUser;

export type RequestHeaders = Record<string, string | string[] | undefined>;

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedRequestUser;
  headers: RequestHeaders;
  session?: Record<string, unknown>;
};

export type RequestWithUser = AuthenticatedRequest;
export type RequestWithActor = AuthenticatedRequest;

function normalizeScopeList(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.filter(
    (entry): entry is string | number =>
      (typeof entry === 'string' && entry.trim().length > 0) ||
      (typeof entry === 'number' && Number.isFinite(entry)),
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeDataScope(value: unknown): DataScope | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const source = value as DataScope;
  const normalized: DataScope = {};

  const provinces = normalizeScopeList(source.provinces);
  if (provinces) {
    normalized.provinces = provinces.map(String);
  }

  const districts = normalizeScopeList(source.districts);
  if (districts) {
    normalized.districts = districts.map(String);
  }

  const subDistricts = normalizeScopeList(source.sub_districts);
  if (subDistricts) {
    normalized.sub_districts = subDistricts.map(String);
  }

  const schoolIds = normalizeScopeList(source.school_ids);
  if (schoolIds) {
    normalized.school_ids = schoolIds;
  }

  const gradeLevels = normalizeScopeList(source.grade_levels);
  if (gradeLevels) {
    normalized.grade_levels = gradeLevels;
  }

  const roomIds = normalizeScopeList(source.room_ids);
  if (roomIds) {
    normalized.room_ids = roomIds;
  }

  if (source.own_only === true) {
    normalized.own_only = true;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

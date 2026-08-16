import type { Request } from 'express';

export interface DataScope {
  global?: boolean;
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
  teacher_membership_id?: number | null;
  username: string;
  roles: string[];
  permissions: string[];
  data_scope?: DataScope;
  virtual_login?: boolean;
  PersonID_Onec?: string;
  // Opaque surrogate id for a virtual-login student — what the client uses to
  // address its own record (keeps the national id off the wire). This is the
  // *current enrollment* snapshot id.
  student_uuid?: string;
  // Canonical person id (stable across terms/schools). Carried alongside
  // student_uuid so own-access spans all of this person's enrollments, not just
  // the current snapshot. Optional during the B2 transition.
  person_uuid?: string;
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

/** True only for the signed, own-record virtual student identity. */
export function isStudentSelfActor(
  actor?: AuthenticatedRequestUser | null,
): actor is AuthenticatedRequestUser {
  return Boolean(
    actor?.auth_source === 'THAID_MOCK' &&
    actor.virtual_login === true &&
    actor.student_uuid &&
    actor.permissions.includes('student-self') &&
    actor.data_scope?.own_only,
  );
}

/** Supports both persisted student accounts and accountless Mock ThaID sessions. */
export function isStudentAccountActor(actor?: AuthenticatedRequestUser | null): boolean {
  return Boolean(actor?.roles.includes('STUDENT') || isStudentSelfActor(actor));
}

/**
 * Trim, dedupe, and stringify a raw scope array (e.g. an actor's `provinces`
 * or `school_ids`). Shared by permissions validation and the repositories
 * that build scope-filtered SQL — was previously copy-pasted in four places.
 */
export function normalizeScopeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
  );
}

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

  if (source.global === true) {
    normalized.global = true;
  }

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

/**
 * Resolve the scope an authenticated actor brings to a scoped query. Unlike a
 * bare `normalizeDataScope(actor?.data_scope)` — which collapses an empty scope
 * to `undefined` and made repositories skip scope filtering entirely — this
 * keeps an authenticated-but-unconfigured actor as `{}` so scoped reads fail
 * closed. Only "no actor at all" (system/internal calls) resolves to undefined.
 */
export function resolveActorDataScope(
  actor?: Pick<AuthenticatedRequestUser, 'data_scope'> | null,
): DataScope | undefined {
  if (!actor) {
    return undefined;
  }
  return normalizeDataScope(actor.data_scope) || {};
}

/**
 * Whether a scope reaches one classroom.
 *
 * An empty `grade_levels`/`room_ids` means "not confined at that level", which
 * is how every scoped read already treats them — this only narrows an actor who
 * was explicitly limited to grades or rooms, on top of the school check the
 * caller has already done.
 *
 * Both sides are compared as strings on purpose: `data_scope` is JSON written by
 * several code paths and the live data holds both `[1]` and `["1"]`, so a strict
 * comparison silently denies a teacher whose own room is listed.
 */
export function isClassInScope(
  scope: DataScope | undefined,
  classroom: { gradeLevelId: number | string; roomId: number | string },
): boolean {
  const matches = (values: Array<number | string> | undefined, candidate: number | string) =>
    !values?.length || values.map(String).includes(String(candidate));
  return (
    matches(scope?.grade_levels, classroom.gradeLevelId) &&
    matches(scope?.room_ids, classroom.roomId)
  );
}

export function hasAreaDataScope(value: unknown): boolean {
  const normalized = normalizeDataScope(value) || {};
  return (
    (normalized.provinces?.length ?? 0) > 0 ||
    (normalized.districts?.length ?? 0) > 0 ||
    (normalized.sub_districts?.length ?? 0) > 0 ||
    (normalized.school_ids?.length ?? 0) > 0 ||
    (normalized.grade_levels?.length ?? 0) > 0 ||
    (normalized.room_ids?.length ?? 0) > 0
  );
}

/**
 * A scope with no area values that neither declares nationwide (`global:true`)
 * nor self-only (`own_only:true`). Legitimate accounts never persist this shape
 * (see finalizePersistedDataScope + the explicit-global backfill migration), so
 * scoped reads must treat it as misconfigured data and fail closed — never as
 * an implicit "see everything".
 */
export function isUnconfiguredDataScope(value: unknown): boolean {
  const normalized = normalizeDataScope(value) || {};
  return (
    normalized.global !== true && normalized.own_only !== true && !hasAreaDataScope(normalized)
  );
}

/**
 * Shape a validated data scope for persistence. Nationwide must be stored as an
 * explicit `global:true` marker — never inferred from emptiness — because the
 * read path fails closed on an empty scope (see buildDataScopeQuery). An area
 * scope never carries `global` (a stray flag would silently widen it to the
 * whole country), and `own_only` scopes are stored as-is.
 */
export function finalizePersistedDataScope(value: unknown): DataScope {
  const normalized = normalizeDataScope(value) || {};

  // Self-only is a complete scope by itself: canonicalize so stray area values
  // or a stray global flag can never widen (or confuse) a student scope.
  if (normalized.own_only === true) {
    return { own_only: true };
  }

  if (hasAreaDataScope(normalized)) {
    delete normalized.global;
    return normalized;
  }

  return { ...normalized, global: true };
}

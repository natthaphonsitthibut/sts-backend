import type { ActorContext, DataScope, RequestWithActor } from '../auth';

export type { ActorContext, DataScope, RequestWithActor };

export type NormalizedDataScope = Required<Omit<DataScope, 'own_only'>> &
  Pick<DataScope, 'own_only'>;

export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: string;
  scope_policy: 'ASSIGNABLE' | 'OWN_ONLY';
  is_assignable: boolean;
  is_system: boolean;
}

export interface QueryResultRow {
  [key: string]: unknown;
}

export interface QueryResultLike<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount?: number | null;
}

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export function getTaskErrorMessage(error: unknown, fallback = 'เกิดข้อผิดพลาด'): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

export function hasHttpStatusGetter(error: unknown): error is { getStatus: () => number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'getStatus' in error &&
    typeof error.getStatus === 'function'
  );
}

export function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }

  return undefined;
}

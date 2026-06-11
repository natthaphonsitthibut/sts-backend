import type { ActorContext, DataScope } from '../auth/auth.types';
import type { RoleScopeMode } from '../auth/permissions.constants';

export type { ActorContext, DataScope };

export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: RoleScopeMode;
  is_system: boolean;
  user_count?: number;
  login_link_count?: number;
}

export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

export interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export interface RoleRow extends Record<string, unknown> {
  id: number;
  name: string;
  label: string;
  rank: number;
  default_permissions: unknown;
  scope_mode: unknown;
  is_system: boolean;
  user_count?: number;
  login_link_count?: number;
}

export interface HydratableUserRow extends Record<string, unknown> {
  id: number;
  username: string;
  FirstName: string | null;
  LastName: string | null;
  PersonID_Onec: string | null;
  phone: string | null;
  email: string | null;
  affiliation: string | null;
  status: string | null;
  permissions: unknown;
  role: string | null;
  data_scope: DataScope | null;
  must_change_password?: boolean | null;
  created_at?: string | Date | null;
  roles?: string[] | null;
  labels?: string[] | null;
  role_default_permissions?: unknown;
  password?: string;
}

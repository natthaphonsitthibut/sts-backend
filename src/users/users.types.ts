import type { ActorContext, DataScope } from '../auth/auth.types';
import type { RoleScopeMode, RoleScopePolicy } from '../auth/permissions.constants';

export type { ActorContext, DataScope };

export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: RoleScopeMode;
  scope_policy: RoleScopePolicy;
  is_assignable: boolean;
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
  scope_policy: unknown;
  is_assignable: boolean;
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
  temporary_password_issued_at?: string | Date | null;
  temporary_password_expires_at?: string | Date | null;
  created_at?: string | Date | null;
  roles?: string[] | null;
  labels?: string[] | null;
  role_default_permissions?: unknown;
  password?: string;
}

export interface StudentAccountCandidateRow extends Record<string, unknown> {
  student_uuid: string;
  person_uuid: string;
  first_name: string | null;
  last_name: string | null;
  school_id: number;
  school_name: string | null;
  grade_label: string | null;
  grade_level_id: number | null;
  room_id: number | null;
  academic_year: number | null;
  semester: number | null;
  existing_user_id: number | null;
  existing_username: string | null;
}

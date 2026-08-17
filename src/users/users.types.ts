import type { ActorContext, DataScope } from '../auth/auth.types';
import type { RoleScopeMode, RoleScopePolicy } from '../auth/permissions.constants';

export type { ActorContext, DataScope };

/**
 * Derived account lifecycle shown in user lists — computed from
 * `status` + `must_change_password` + `temporary_password_expires_at`
 * (the CASE in `users.repository.ts`), not a persisted column. Single
 * source for the DTO whitelist, filter types, and count records.
 */
export const ACCOUNT_LIFECYCLE_STATUSES = [
  'PENDING_FIRST_LOGIN',
  'ACTIVE',
  'TEMP_PASSWORD_EXPIRED',
  'DISABLED',
] as const;

export type AccountLifecycleStatus = (typeof ACCOUNT_LIFECYCLE_STATUSES)[number];

export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  default_permissions: string[];
  scope_mode: RoleScopeMode;
  scope_policy: RoleScopePolicy;
  is_assignable: boolean;
  is_system: boolean;
  school_id?: number | null;
  user_count?: number;
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
  default_permissions: unknown;
  scope_mode: unknown;
  scope_policy: unknown;
  is_assignable: boolean;
  is_system: boolean;
  school_id?: number | null;
  user_count?: number;
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
  photo_storage_key?: string | null;
  line_id?: string | null;
  address_line?: string | null;
  address_village_no?: string | null;
  address_street?: string | null;
  address_soi?: string | null;
  address_trok?: string | null;
  address_sub_district?: string | null;
  address_district?: string | null;
  address_province?: string | null;
  address_postal_code?: string | null;
  address_latitude?: number | null;
  address_longitude?: number | null;
  status: string | null;
  permissions: unknown;
  role: string | null;
  data_scope: DataScope | null;
  must_change_password?: boolean | null;
  temporary_password_issued_at?: string | Date | null;
  temporary_password_expires_at?: string | Date | null;
  deactivated_at?: string | Date | null;
  deactivated_by?: number | null;
  deactivation_reason_code?: string | null;
  deactivation_note?: string | null;
  created_at?: string | Date | null;
  roles?: string[] | null;
  labels?: string[] | null;
  role_default_permissions?: unknown;
  password?: string;
  student_uuid?: string;
}

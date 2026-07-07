import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

/**
 * Closed vocabulary of audited sensitive actions. Centralised so both the
 * users/auth wiring and the task/imports/master-data wiring stay in sync and
 * a typo can't silently create an un-greppable action.
 */
export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_PROFILE_UPDATE',
  'USER_DELETE',
  'USER_DEACTIVATE',
  'USER_REACTIVATE',
  'USER_TEMP_PASSWORD_REISSUE',
  'STUDENT_CREATE',
  'STUDENT_UPDATE',
  'STUDENT_DELETE',
  'STUDENT_ACCOUNT_BULK_GENERATE',
  'STUDENT_ACCOUNT_BATCH_ENQUEUE',
  'STUDENT_ACCOUNT_BATCH_RESUME',
  'STUDENT_ACCOUNT_BATCH_CANCEL',
  'STUDENT_ACCOUNT_DEACTIVATE',
  'STUDENT_ACCOUNT_REACTIVATE',
  'STUDENT_TEMP_PASSWORD_REISSUE',
  'ROLE_GROUP_CREATE',
  'ROLE_GROUP_UPDATE',
  'ROLE_GROUP_DELETE',
  'CASE_CLOSE',
  'CASE_FORWARD',
  'CASE_REFERRAL_OUTCOME_UPDATE',
  'CASE_REVIEW',
  'CASE_AUTO_CANCEL',
  'CASE_RISK_TIER_ESCALATE',
  'CASE_SLA_WARNING',
  'CASE_SLA_BREACHED',
  'ATTENDANCE_SUBMIT',
  'ATTENDANCE_REOPEN',
  'TASK_CREATE',
  'TASK_DELETE',
  'LINK_LOCK',
  'LINK_UNLOCK',
  'DELEGATION',
  'DATA_IMPORT',
  'IMPORT_QUARANTINE_RESOLVED',
  'IMPORT_QUARANTINE_REJECTED',
  'IMPORT_QUARANTINE_EXPORT',
  'MASTER_DATA_EDIT',
  'SYSTEM_SETTING_EDIT',
  'FIELD_FOLLOWER_APPLY',
  'FIELD_FOLLOWER_REVIEW',
  'FIELD_MAP_VIEW',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_LOG_DOMAINS = [
  'student_accounts',
  'imports',
  'users',
  'login_links',
  'students',
  'cases',
  'tasks',
  'attendance',
  'field_followers',
] as const;

export type AuditLogDomain = (typeof AUDIT_LOG_DOMAINS)[number];

export const AUDIT_LOG_TASK_TYPES = ['ATTENDANCE', 'VISIT', 'LOGIN'] as const;

export type AuditLogTaskType = (typeof AUDIT_LOG_TASK_TYPES)[number];

export class GetAuditLogQueryDto extends PaginationQueryDto {
  @IsIn(AUDIT_LOG_DOMAINS)
  domain!: AuditLogDomain;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  @IsOptional()
  @IsString()
  searchTerm?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  subDistrict?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @IsIn(AUDIT_LOG_TASK_TYPES)
  taskType?: AuditLogTaskType;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  caseId?: number;
}

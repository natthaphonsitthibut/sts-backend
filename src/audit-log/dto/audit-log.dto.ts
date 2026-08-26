import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
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
  'STUDENT_NATIONAL_ID_CORRECTION',
  'STUDENT_DELETE',
  'ROLE_GROUP_CREATE',
  'ROLE_GROUP_UPDATE',
  'ROLE_GROUP_DELETE',
  'CASE_CREATE',
  'CASE_CLOSE',
  'CASE_REFER_AGENCY',
  'CASE_ASSIST',
  'CASE_REVIEW',
  'CASE_AUTO_CANCEL',
  'CASE_RISK_SIGNAL_DETECTED',
  'CASE_RISK_TIER_ESCALATE',
  'CASE_SLA_WARNING',
  'CASE_SLA_BREACHED',
  'ATTENDANCE_SUBMIT',
  'ATTENDANCE_REOPEN',
  'CLASSROOM_ATTENDANCE_LINK_BULK_CREATE',
  'CLASSROOM_ATTENDANCE_LINK_ROTATE',
  'CLASSROOM_ATTENDANCE_LINK_DEACTIVATE',
  'CLASSROOM_ATTENDANCE_LINK_LINE_SEND',
  'TASK_CREATE',
  'TASK_DELETE',
  'TASK_CANCEL',
  'TASK_EXPIRE',
  'LINK_LOCK',
  'LINK_UNLOCK',
  'TEACHER_ACCESS_GRANT_ISSUE',
  'TEACHER_ACCESS_GRANT_UPDATE',
  'TEACHER_ACCESS_GRANT_REVOKE',
  'TEACHER_ACCESS_GRANT_ROTATE',
  'TEACHER_ACCESS_GRANT_USE',
  'TEACHER_ACCESS_GRANT_DENIED',
  'TEACHER_ACCESS_GRANT_REVEAL',
  'TEACHER_ACCESS_GRANT_SEND',
  'TEACHER_ACCESS_ARAID_VERIFY',
  'TASK_LINK_ARAID_VERIFY',
  'TASK_LINK_GOOGLE_VERIFY',
  'TEACHER_ACCESS_ARAID_FAILED',
  'TEACHER_MESSAGING_LINK',
  'TEACHER_LINE_INVITATION_ISSUE',
  'TEACHER_LINE_INVITATION_REVOKE',
  'TEACHER_MESSAGING_UNLINK',
  'TEACHER_MESSAGING_LINK_DENIED',
  'STUDENT_OBSERVATION_CREATE',
  'STUDENT_OBSERVATION_UPDATE',
  'STUDENT_OBSERVATION_VIEW',
  'DELEGATION',
  'DATA_IMPORT',
  'CLASSROOM_DATA_EXPORT',
  'IMPORT_QUARANTINE_RESOLVED',
  'IMPORT_QUARANTINE_REJECTED',
  'IMPORT_QUARANTINE_EXPORT',
  'MASTER_DATA_EDIT',
  'SYSTEM_SETTING_EDIT',
  'SUBJECT_CREATE',
  'SUBJECT_UPDATE',
  'SCHOOL_SUBJECT_UPSERT',
  'SCHOOL_SUBJECT_STATUS_UPDATE',
  'CLASSROOM_SUBJECTS_REPLACE',
  'TIMETABLE_SLOT_CREATE',
  'TIMETABLE_SLOT_UPDATE',
  'TIMETABLE_SLOT_DELETE',
  'PERIOD_TIME_GENERATE',
  'PERIOD_TIME_OVERRIDE',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_LOG_DOMAINS = [
  'imports',
  'users',
  'students',
  'cases',
  'tasks',
  'attendance',
  'timetable',
  'subjects',
] as const;

export type AuditLogDomain = (typeof AUDIT_LOG_DOMAINS)[number];

export const AUDIT_LOG_TASK_TYPES = ['VISIT', 'ASSIST'] as const;

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
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
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

export class GetAuditLogActionsQueryDto {
  @IsIn(AUDIT_LOG_DOMAINS)
  domain!: AuditLogDomain;

  @IsOptional()
  @IsIn(AUDIT_LOG_TASK_TYPES)
  taskType?: AuditLogTaskType;
}

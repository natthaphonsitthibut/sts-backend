import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const AUDIT_LOG_DOMAINS = [
  'student_accounts',
  'imports',
  'users',
  'login_links',
  'students',
  'cases',
  'tasks',
  'attendance',
] as const;

export type AuditLogDomain = (typeof AUDIT_LOG_DOMAINS)[number];

export const AUDIT_LOG_TASK_TYPES = ['ATTENDANCE', 'VISIT', 'LOGIN'] as const;

export type AuditLogTaskType = (typeof AUDIT_LOG_TASK_TYPES)[number];

export class GetAuditLogQueryDto extends PaginationQueryDto {
  @IsIn(AUDIT_LOG_DOMAINS)
  domain!: AuditLogDomain;

  @IsOptional()
  @IsString()
  action?: string;

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

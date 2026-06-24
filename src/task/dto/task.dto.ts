import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export type TaskDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type TaskLinkAdminAction = 'lock' | 'unlock';
export type AttendanceTaskStatus = 'P_PRESENT' | 'P_ABSENT' | 'P_LATE';

// Fields are intentionally loose unions (string | number | null) because the
// service coerces them downstream. Every property carries at least @IsOptional()
// so the global ValidationPipe `whitelist` keeps it instead of stripping it; the
// scalar fields stay untyped on purpose to avoid rejecting currently-valid input.
export class CreateTaskDto {
  @IsOptional()
  task_type?: string;

  @IsOptional()
  type?: string;

  @IsOptional()
  assigned_to_name?: string | null;

  @IsOptional()
  assigned_to_email?: string | null;

  @IsOptional()
  assigned_to_phone?: string | null;

  @IsOptional()
  expires_value?: string | number | null;

  @IsOptional()
  expires_unit?: string | null;

  @IsOptional()
  student_name?: string | null;

  @IsOptional()
  @IsUUID()
  student_id?: string | null;

  @IsOptional()
  student_school?: string | null;

  @IsOptional()
  student_address?: string | null;

  @IsOptional()
  student_lat?: string | number | null;

  @IsOptional()
  student_lng?: string | number | null;

  @IsOptional()
  reason_flagged?: string | null;

  @IsOptional()
  target_grade?: string | null;

  @IsOptional()
  target_room?: string | null;

  @IsOptional()
  subject?: string | null;

  @IsOptional()
  target_school_id?: string | number | null;

  @IsOptional()
  role?: string | null;

  // Alternative role inputs that TaskPolicyService.normalizeRole() reads as
  // fallbacks for LOGIN links. Declared so `whitelist` keeps them instead of
  // silently stripping (which would drop the role back to the default).
  @IsOptional()
  selected_role?: string | null;

  @IsOptional()
  @IsArray()
  roles?: string[];

  @IsOptional()
  @IsArray()
  permissions?: string[];

  @IsOptional()
  @IsArray()
  mock_permissions?: string[];

  @IsOptional()
  @IsObject()
  data_scope?: Record<string, unknown>;

  @IsOptional()
  existing_case_id?: string | number | null;
}

export class TaskAttendanceRecordDto {
  @IsString()
  @IsNotEmpty()
  student_id?: string;

  @IsString()
  @IsIn(['P_PRESENT', 'P_ABSENT', 'P_LATE'])
  status?: AttendanceTaskStatus;
}

export class SaveTaskAttendanceDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TaskAttendanceRecordDto)
  records?: TaskAttendanceRecordDto[];
}

// Loose unions coerced by the service; @IsOptional() keeps each field through the
// ValidationPipe whitelist. (Primary submit flow is multipart via SubmissionController.)
export class SaveTaskSubmissionDto {
  @IsOptional()
  visit_lat?: string | number | null;

  @IsOptional()
  visit_lng?: string | number | null;

  @IsOptional()
  cause_category?: string | null;

  @IsOptional()
  cause_detail?: string | null;

  @IsOptional()
  notes?: string | null;

  @IsOptional()
  recommendation?: string | null;

  @IsOptional()
  photo_paths?: string | null;

  @IsOptional()
  address_changed?: boolean | string | number | null;

  @IsOptional()
  updated_student_address?: string | null;

  @IsOptional()
  updated_lat?: string | number | null;

  @IsOptional()
  updated_lng?: string | number | null;

  @IsOptional()
  status?: string | null;
}

export class DelegateTaskDto {
  @IsString()
  @IsNotEmpty()
  new_assignee_name?: string | null;

  @IsOptional()
  @IsString()
  new_assignee_phone?: string | null;

  @IsOptional()
  @IsString()
  new_assignee_email?: string | null;

  @IsOptional()
  expires_in_hours?: string | number | null;
}

export class ReviewCaseDto {
  @IsString()
  @IsNotEmpty()
  review_action?: string | null;

  @IsOptional()
  @IsString()
  review_note?: string | null;

  @IsOptional()
  @IsString()
  // Legacy clients may still send this, but the service deliberately ignores it.
  // Reviewer attribution must come from the authenticated actor, not the body.
  reviewed_by?: string | null;
}

export class GetCasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;
}

export class GetLoginLinksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'LOCKED', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;
}

export class AdminLockLinkDto {
  @IsString()
  @IsIn(['lock', 'unlock'])
  action?: TaskLinkAdminAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

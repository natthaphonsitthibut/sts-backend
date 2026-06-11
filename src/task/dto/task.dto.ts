import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export type TaskDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type TaskLinkAdminAction = 'lock' | 'unlock';
export type AttendanceTaskStatus = 'P_PRESENT' | 'P_ABSENT' | 'P_LATE';

export class CreateTaskDto {
  task_type?: string;
  type?: string;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  assigned_to_phone?: string | null;
  expires_value?: string | number | null;
  expires_unit?: string | null;
  student_name?: string | null;
  student_school?: string | null;
  student_address?: string | null;
  student_lat?: string | number | null;
  student_lng?: string | number | null;
  reason_flagged?: string | null;
  target_grade?: string | null;
  target_room?: string | null;
  subject?: string | null;
  target_school_id?: string | number | null;
  role?: string | null;
  permissions?: string[];
  mock_permissions?: string[];
  data_scope?: Record<string, unknown>;
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

export class SaveTaskSubmissionDto {
  visit_lat?: string | number | null;
  visit_lng?: string | number | null;
  cause_category?: string | null;
  cause_detail?: string | null;
  notes?: string | null;
  recommendation?: string | null;
  photo_paths?: string | null;
  address_changed?: boolean | string | number | null;
  updated_student_address?: string | null;
  updated_lat?: string | number | null;
  updated_lng?: string | number | null;
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
  reviewed_by?: string | null;
}

export class AdminLockLinkDto {
  @IsString()
  @IsIn(['lock', 'unlock'])
  action?: TaskLinkAdminAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

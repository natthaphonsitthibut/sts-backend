import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { MAX_LINK_LIFETIME_HOURS } from '../task-link-expiry';
import {
  ATTENDANCE_SELECTION_STATUS_VALUES,
  type AttendanceSelectionStatus,
} from '../../attendance/attendance-status';

export type TaskDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type TaskLinkAdminAction = 'lock' | 'unlock';
export type AttendanceTaskStatus = AttendanceSelectionStatus;
export type CaseResolutionOutcome =
  | 'RETURNED_TO_SCHOOL'
  | 'TRANSFERRED_SCHOOL'
  | 'ILLNESS'
  | 'WORKING'
  | 'UNREACHABLE'
  | 'OTHER';

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
  @IsString()
  @MaxLength(150)
  assigned_to_first_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  assigned_to_last_name?: string | null;

  @IsOptional()
  assigned_to_email?: string | null;

  @IsOptional()
  assigned_to_phone?: string | null;

  @IsOptional()
  expires_value?: string | number | null;

  @IsOptional()
  expires_unit?: string | null;

  /** Optional ISO datetime the link becomes usable; omit/null = opens immediately. */
  @IsOptional()
  @IsDateString()
  opens_at?: string | null;

  /** Optional explicit deadline for assignments that use a date/time range. */
  @IsOptional()
  @IsDateString()
  expires_at?: string | null;

  @IsOptional()
  student_name?: string | null;

  @IsOptional()
  student_first_name?: string | null;

  @IsOptional()
  student_last_name?: string | null;

  @IsOptional()
  @IsUUID()
  student_id?: string | null;

  @IsOptional()
  student_school?: string | null;

  @IsOptional()
  student_address?: string | null;

  @IsOptional()
  address_line?: string | null;

  @IsOptional()
  address_province?: string | null;

  @IsOptional()
  address_district?: string | null;

  @IsOptional()
  address_sub_district?: string | null;

  @IsOptional()
  postal_code?: string | null;

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
  subject_id?: string | number | null;

  @IsOptional()
  @IsArray()
  timetable_slot_ids?: Array<string | number>;

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

  /** Approved follow-up request consumed by this VISIT assignment. */
  @IsOptional()
  @IsUUID()
  follow_up_request_id?: string | null;

  @IsOptional()
  source_field_follower_id?: string | number | null;

  @IsOptional()
  campaign_target_id?: string | number | null;
}

export class TaskAttendanceRecordDto {
  @IsString()
  @IsNotEmpty()
  student_id?: string;

  @IsString()
  @IsIn(ATTENDANCE_SELECTION_STATUS_VALUES)
  status?: AttendanceTaskStatus;
}

export class SaveTaskAttendanceDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TaskAttendanceRecordDto)
  records?: TaskAttendanceRecordDto[];

  @IsOptional()
  timetable_slot_id?: string | number | null;
}

// Loose unions coerced by the service; @IsOptional() keeps each field through the
// ValidationPipe whitelist. (Primary submit flow is multipart via SubmissionController.)
export class SaveTaskSubmissionDto {
  @IsOptional()
  @IsString()
  case_follow_up_decision?: string | null;

  @IsOptional()
  @IsString()
  case_resolution_outcome_code?: string | null;

  @IsOptional()
  visit_lat?: string | number | null;

  @IsOptional()
  visit_lng?: string | number | null;

  @IsOptional()
  @IsDateString()
  visited_at?: string | null;

  @IsOptional()
  cause_category?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  follow_up_assessment_code?: string | null;

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
  @IsString()
  @MaxLength(40)
  home_visit_exception_code?: string | null;

  @IsOptional()
  updated_student_address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  updated_address_line?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  updated_address_province?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  updated_address_district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  updated_address_sub_district?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/)
  updated_postal_code?: string | null;

  @IsOptional()
  updated_lat?: string | number | null;

  @IsOptional()
  updated_lng?: string | number | null;

  @IsOptional()
  status?: string | null;
}

export class DelegateTaskDto {
  /** @deprecated Send structured first/last name fields for new clients. */
  @IsOptional()
  @IsString()
  new_assignee_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  new_assignee_first_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  new_assignee_last_name?: string | null;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{9,10}$/)
  new_assignee_phone?: string | null;

  @IsEmail()
  @IsString()
  @IsNotEmpty()
  new_assignee_email?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  delegation_note?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINK_LIFETIME_HOURS)
  expires_in_hours?: number | null;

  @IsOptional()
  @IsDateString()
  expires_at?: string | null;
}

export class ReviewCaseDto {
  @IsString()
  @IsNotEmpty()
  review_action?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  review_note!: string;

  @IsOptional()
  @IsIn(['RETURNED_TO_SCHOOL', 'TRANSFERRED_SCHOOL', 'ILLNESS', 'WORKING', 'UNREACHABLE', 'OTHER'])
  resolution_outcome?: CaseResolutionOutcome | null;

  @IsOptional()
  @IsString()
  // Legacy clients may still send this, but the service deliberately ignores it.
  // Reviewer attribution must come from the authenticated actor, not the body.
  reviewed_by?: string | null;
}

export class OpenCaseDto {
  @IsUUID()
  student_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class GetCasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;

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
  schoolId?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  room?: string;
}

export const RISK_DASHBOARD_TIERS = ['ALL', 'HIGH', 'WATCH', 'NORMAL'] as const;
export const RISK_DASHBOARD_SORT_FIELDS = [
  'risk',
  'name',
  'school',
  'grade',
  'room',
  'attendance',
  'openCases',
] as const;
export const RISK_DASHBOARD_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export class GetRiskDashboardQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(RISK_DASHBOARD_TIERS)
  riskTier?: (typeof RISK_DASHBOARD_TIERS)[number];

  @IsOptional()
  @IsString()
  searchTerm?: string;

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
  schoolId?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsIn(RISK_DASHBOARD_SORT_FIELDS)
  sortBy?: (typeof RISK_DASHBOARD_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(RISK_DASHBOARD_SORT_DIRECTIONS)
  sortDirection?: (typeof RISK_DASHBOARD_SORT_DIRECTIONS)[number];
}

export class GetLoginLinksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'LOCKED', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;

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
  schoolId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gradeLevelId?: number;

  @IsOptional()
  @IsString()
  room?: string;
}

export class GetVisitLinksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'SCHEDULED', 'ACTIVE', 'LOCKED', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;

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
  schoolId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gradeLevelId?: number;

  @IsOptional()
  @IsString()
  room?: string;
}

export class AdminLockLinkDto {
  @IsString()
  @IsIn(['lock', 'unlock'])
  action?: TaskLinkAdminAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

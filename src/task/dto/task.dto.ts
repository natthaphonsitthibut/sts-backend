import { Type } from 'class-transformer';
import { ExternalOAuthCallbackDto } from '../../common/dto/external-oauth-callback.dto';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export type TaskDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type TaskLinkAdminAction = 'lock' | 'unlock';
export type CaseResolutionOutcome =
  | 'RETURNED_TO_SCHOOL'
  | 'TRANSFERRED_SCHOOL'
  | 'ILLNESS'
  | 'WORKING'
  | 'UNREACHABLE'
  | 'OTHER';

export class GetReferralDrilldownQueryDto extends PaginationQueryDto {}

export class TaskGoogleCallbackDto extends ExternalOAuthCallbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  state?: string;
}

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

  /**
   * Selected from the active teachers of the selected VISIT student's school.
   * The lifecycle service resolves the name/email server-side; this id is never
   * trusted as an unrestricted user reference.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigned_teacher_id?: number | null;

  /**
   * Assistance rounds only: which measures this assignment commits to. Picked
   * here so the report form can render them read-only.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  assistance_measure_codes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  assistance_measure_detail?: string | null;

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

  /** Optional instruction shown to the assigned teacher for this case follow-up. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  assignment_note?: string | null;
}

// Loose unions coerced by the service; @IsOptional() keeps each field through the
// ValidationPipe whitelist. (Primary submit flow is multipart via SubmissionController.)
export class SaveTaskSubmissionDto {
  @IsOptional()
  @IsString()
  @IsIn(['SUCCEEDED', 'NOT_SUCCEEDED'])
  task_execution_outcome_code?: 'SUCCEEDED' | 'NOT_SUCCEEDED' | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  non_follow_up_reason_code?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  disadvantage_type_codes?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  disability_type_codes?: string[] | null;

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
  @IsString()
  @MaxLength(32)
  follow_up_problem_category_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  absence_reason_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  absence_reason_category_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  parental_status_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  guardian_type_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  guardian_type_detail?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  residence_environment_codes?: string[] | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  residence_environment_detail?: string | null;

  /** Assistance rounds only: when the help was actually given. */
  @IsOptional()
  @IsDateString()
  assisted_at?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  assistance_detail?: string | null;

  /** Optional explanation for an unsuccessful ASSIST round. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  execution_outcome_detail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact_person_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  contact_channel_code?: string | null;

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

export class ReviewCaseDto {
  @IsString()
  @IsNotEmpty()
  review_action?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  review_note!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  assistance_measure_codes?: string[] | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  assistance_measure_detail?: string | null;

  @IsOptional()
  @IsIn(['RETURNED_TO_SCHOOL', 'TRANSFERRED_SCHOOL', 'ILLNESS', 'WORKING', 'UNREACHABLE', 'OTHER'])
  resolution_outcome?: CaseResolutionOutcome | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  referral_agency_id?: number | null;

  @IsOptional()
  @IsString()
  // Legacy clients may still send this, but the service deliberately ignores it.
  // Reviewer attribution must come from the authenticated actor, not the body.
  reviewed_by?: string | null;
}

export class CancelCaseAssignmentDto {
  /**
   * Required: withdrawing work already handed to a teacher has to say why, and
   * the case history shows this back to whoever picks the case up next.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  cancel_reason!: string;
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
  'updatedAt',
  'problemCategory',
] as const;
export const RISK_DASHBOARD_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const RISK_DASHBOARD_CASE_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'STUDENT_NOT_FOUND',
  'RESOLVED',
] as const;
export const RISK_DASHBOARD_STUDENT_GROUPS = ['RISK', 'WATCHLIST'] as const;
/** Mirrors the classroom_student_comment_concern_levels catalog. */
export const RISK_DASHBOARD_CONCERN_LEVELS = ['NOTE', 'WATCH', 'CONCERN'] as const;

export class GetRiskDashboardQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(RISK_DASHBOARD_STUDENT_GROUPS)
  studentGroup?: (typeof RISK_DASHBOARD_STUDENT_GROUPS)[number];

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  academicYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  semester?: number;

  @IsOptional()
  @IsIn(RISK_DASHBOARD_CASE_STATUSES)
  caseStatus?: (typeof RISK_DASHBOARD_CASE_STATUSES)[number];

  @IsOptional()
  @IsIn(RISK_DASHBOARD_CONCERN_LEVELS)
  concernLevel?: (typeof RISK_DASHBOARD_CONCERN_LEVELS)[number];

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

export class AdminLockLinkDto {
  @IsString()
  @IsIn(['lock', 'unlock'])
  action?: TaskLinkAdminAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

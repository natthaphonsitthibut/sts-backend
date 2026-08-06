import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import type { TeacherLineFilter } from '../teacher-access.repository';
import {
  ATTENDANCE_SELECTION_STATUS_VALUES,
  type AttendanceSelectionStatus,
} from '../../attendance/attendance-status';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A teacher link covers every class that teacher is assigned this term, so the
 * caller picks the teacher and the term only — capabilities and assignments are
 * derived server-side and cannot be widened from the client.
 */
export class IssueTeacherAccessGrantDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacherMembershipId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

/**
 * Without `teacherMembershipIds` the term is issued in full: every teacher who
 * still needs a link gets one. With it, only the picked teachers are considered —
 * the picks are still filtered against the actor's scope and the term, so a
 * client cannot widen the batch beyond what it may already issue one by one.
 */
export class IssueTeacherAccessGrantsForTermDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  teacherMembershipIds?: number[];
}

/** Sending covers the whole term unless rows are picked, mirroring the issue action. */
export class SendTeacherAccessGrantsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  /** Stable across transport retries so LINE can deduplicate each recipient. */
  @IsUUID('4')
  deliveryRequestId!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  teacherMembershipIds?: number[];
}

export class ListTeacherLinkRosterDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['VERIFIED', 'NOT_VERIFIED', 'REACHABLE'])
  lineStatus?: TeacherLineFilter;

  @IsOptional()
  @IsIn(['name', 'linkStatus'])
  sortBy?: 'name' | 'linkStatus';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class VerifyTeacherAccessOtpDto {
  @Transform(trimText)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก' })
  otp!: string;
}

export class ListTeacherAccessGrantsDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId?: number;

  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'REVOKED', 'EXPIRED', 'SUSPENDED'])
  status?: 'ALL' | 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED';
}

export class TeacherAccessAssignmentOptionsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacherMembershipId!: number;
}

export class RevokeTeacherAccessGrantDto {
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class TeacherAccessTokenHeaderDto {
  @Transform(trimText)
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class TeacherAccessRosterQueryDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class TeacherAccessAttendanceHistoryQueryDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  attendanceDate?: string;

  @IsOptional()
  @IsIn(['date', 'recordedBy', 'present', 'late', 'leave', 'absent'])
  sortBy?: 'date' | 'recordedBy' | 'present' | 'late' | 'leave' | 'absent';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class TeacherAccessAttendanceRecordDto {
  @IsUUID()
  studentId!: string;

  @IsIn(ATTENDANCE_SELECTION_STATUS_VALUES)
  status!: AttendanceSelectionStatus;
}

export class RecordTeacherAccessExportDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsIn(['ROSTER', 'ATTENDANCE'])
  exportScope!: 'ROSTER' | 'ATTENDANCE';

  @IsIn(['pdf', 'xlsx', 'csv'])
  format!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  columns!: string[];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;
}

export class CreateTeacherAccessStudentCommentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsUUID()
  studentUuid!: string;

  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  commentText!: string;
}

export class TeacherAccessStudentProfileQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsUUID()
  studentUuid!: string;
}

export class TeacherAccessStudentSubjectAttendanceQueryDto extends TeacherAccessStudentProfileQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

export class TeacherAccessAssignmentQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;
}

/** Multipart: every field is optional so colour, framing and photo can move alone. */
export class UpdateTeacherAccessClassroomCardDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  cardCoverColor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coverImagePositionX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coverImagePositionY?: number;

  @IsOptional()
  @Type(() => Number)
  coverImageScale?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  removeCover?: boolean;
}

export class SaveTeacherAccessAttendanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  /** Required only when a subject meets more than once on the chosen day. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetableSlotId?: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TeacherAccessAttendanceRecordDto)
  records!: TeacherAccessAttendanceRecordDto[];
}

export class TeacherAccessAttendanceSlotsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

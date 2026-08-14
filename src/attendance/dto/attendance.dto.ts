import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ISO_DATE_PATTERN } from './attendance-operations.dto';
import { ATTENDANCE_SELECTION_STATUS_VALUES } from '../attendance-status';

const ATTENDANCE_STATUS_VALUES = ATTENDANCE_SELECTION_STATUS_VALUES;
const ATTENDANCE_SESSION_KIND_VALUES = ['DAILY', 'SUBJECT'] as const;

export class GetSchoolsQueryDto {
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
  @IsString()
  @MaxLength(100)
  searchTerm?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class GetStudentsQueryDto {
  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsString()
  schoolId?: string;
}

export class GetHistoryQueryDto {
  @IsString()
  @IsNotEmpty()
  date!: string;

  // Bounds the query to one school's day. Without it a global/area admin would
  // pull a whole day of attendance nationwide; the read path returns empty when
  // it is absent.
  @IsOptional()
  @IsString()
  schoolId?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_SESSION_KIND_VALUES)
  sessionKind?: (typeof ATTENDANCE_SESSION_KIND_VALUES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetableSlotId?: number;
}

export class GetRoomsQueryDto {
  @IsString()
  @IsNotEmpty()
  grade!: string;

  @IsOptional()
  @IsString()
  schoolId?: string;
}

export class AttendanceRecordDto {
  @IsUUID()
  student_id!: string;

  @IsString()
  @IsIn(ATTENDANCE_STATUS_VALUES)
  status!: string;

  /**
   * When the teacher tapped this status on their device (ISO 8601). Optional so
   * older clients keep working; the server clamps it into the attendance day
   * before persisting, and `"RecordedAt"` remains the server-side truth.
   */
  @IsOptional()
  @IsISO8601()
  marked_at?: string;
}

/**
 * Autosave payload for a check-in in progress. Unlike {@link SaveAttendanceDto}
 * this may carry a subset of the class — the round is not being closed yet.
 */
export class SaveAttendanceMarksDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  records?: AttendanceRecordDto[];

  /**
   * Students whose mark the teacher took back (tapping the same status twice).
   * Their stored row is deleted so the next prefill does not bring it back.
   */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  cleared_student_ids?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetable_slot_id?: number;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN)
  date?: string;
}

export class SaveAttendanceDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  records!: AttendanceRecordDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetable_slot_id?: number;

  /** Attendance date to record for, `YYYY-MM-DD`; omit for today. */
  @IsOptional()
  @Matches(ISO_DATE_PATTERN)
  date?: string;
}

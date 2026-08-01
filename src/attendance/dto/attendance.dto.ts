import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
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
import { PaginatedSearchQueryDto } from '../../common/pagination/pagination.dto';
import { ISO_DATE_PATTERN } from './attendance-operations.dto';
import { ATTENDANCE_SELECTION_STATUS_VALUES } from '../attendance-status';

const ATTENDANCE_STATUS_VALUES = ATTENDANCE_SELECTION_STATUS_VALUES;
const ATTENDANCE_SESSION_KIND_VALUES = ['DAILY', 'SUBJECT'] as const;

export const ATTENDANCE_LINK_STATE_VALUES = ['ALL', 'ACTIVE', 'LOCKED', 'EXPIRED'] as const;

export class GetAttendanceTasksQueryDto extends PaginatedSearchQueryDto {
  @IsOptional()
  @IsIn(ATTENDANCE_LINK_STATE_VALUES)
  status?: (typeof ATTENDANCE_LINK_STATE_VALUES)[number];

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

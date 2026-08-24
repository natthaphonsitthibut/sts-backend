import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ISO_DATE_PATTERN } from './attendance-operations.dto';

const EXCEPTION_STATUSES = ['P_ABSENT', 'P_LATE', 'P_LEAVE'] as const;

export class CheckInOptionsQueryDto {
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  date!: string;
}

export class InternalCheckInOptionsQueryDto extends CheckInOptionsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class InternalCheckInRosterQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class StartExceptionAttendanceDto {
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  date!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomSubjectId!: number;
}

export class StartInternalExceptionAttendanceDto extends StartExceptionAttendanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class AttendanceExceptionDto {
  @IsUUID()
  studentId!: string;

  @IsIn(EXCEPTION_STATUSES)
  status!: (typeof EXCEPTION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  absenceReasonCode?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  markedAt?: string;
}

export class SubmitExceptionAttendanceDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceExceptionDto)
  exceptions!: AttendanceExceptionDto[];
}

export class CheckInStudentPhotoQueryDto {
  @IsUUID()
  studentId!: string;
}

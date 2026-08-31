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
  Length,
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

  /**
   * Which room the teacher is working in. Optional because a link that reaches
   * exactly one room needs no choosing; whatever is named is still checked
   * against the subjects that teacher was assigned.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

export class InternalCheckInOptionsQueryDto extends CheckInOptionsQueryDto {
  /** Required in the app: there is no link to imply which room this is. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare classroomId: number;
}

export class CheckInRosterQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomSubjectId?: number;
}

/** Both halves are required: this names one lesson, not a day or a subject. */
export class CheckInLessonSessionQueryDto {
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  date!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomSubjectId!: number;
}

export class InternalCheckInSessionQueryDto extends CheckInLessonSessionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class InternalCheckInRosterQueryDto extends CheckInRosterQueryDto {
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

  /** The room, for a link that reaches more than one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

export class StartInternalExceptionAttendanceDto extends StartExceptionAttendanceDto {
  /** Required in the app: there is no link to imply which room this is. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare classroomId: number;
}

export class AttendanceExceptionDto {
  @IsUUID()
  studentId!: string;

  @IsIn(EXCEPTION_STATUSES)
  status!: (typeof EXCEPTION_STATUSES)[number];

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

  /** Required only when replacing a result that was already submitted. */
  @IsOptional()
  @IsString()
  @Length(3, 500)
  correctionReason?: string;

  /** Prevents one teacher from silently overwriting a newer submitted result. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedLockVersion?: number;
}

export class CheckInStudentPhotoQueryDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  v?: string;
}

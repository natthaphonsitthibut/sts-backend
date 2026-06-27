import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/pagination/pagination.dto';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TERM_STATUS_VALUES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
const CALENDAR_DAY_TYPE_VALUES = ['SCHOOL_DAY', 'HOLIDAY', 'CANCELLED'] as const;

export class ListSchoolTermsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;
}

export class UpsertSchoolTermDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  academicYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  semester!: number;

  @IsString()
  @Matches(ISO_DATE_PATTERN)
  startsOn!: string;

  @IsString()
  @Matches(ISO_DATE_PATTERN)
  endsOn!: string;

  @IsString()
  @IsIn(TERM_STATUS_VALUES)
  status!: (typeof TERM_STATUS_VALUES)[number];
}

export class GenerateSchoolCalendarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  schoolDays!: number[];
}

export class ListSchoolCalendarQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId!: number;
}

export class UpdateSchoolCalendarDayDto {
  @IsString()
  @IsIn(CALENDAR_DAY_TYPE_VALUES)
  dayType!: (typeof CALENDAR_DAY_TYPE_VALUES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class AttendanceSessionContextQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  grade!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  room!: number;

  @IsString()
  @Matches(ISO_DATE_PATTERN)
  date!: string;
}

export class AttendanceReconciliationQueryDto extends PaginatedSearchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId!: number;

  @IsString()
  @Matches(ISO_DATE_PATTERN)
  date!: string;
}

export class ReopenAttendanceSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

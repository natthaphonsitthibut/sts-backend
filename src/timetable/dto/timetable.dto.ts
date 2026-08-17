import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ListTimetableSlotsQueryDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  gradeLevelId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomNo!: number;
}

export class RoomSubjectsQueryDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  gradeLevelId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomNo!: number;
}

export class TimetableTeachersQueryDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subjectId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gradeLevelId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  roomNo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class CreateTimetableSlotDto {
  @Type(() => Number)
  @IsInt()
  schoolTermId!: number;

  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  gradeLevelId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomNo!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  period!: number;

  @Type(() => Number)
  @IsInt()
  subjectId!: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  teacherMembershipIds?: number[];
}

export class UpdateTimetableSlotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subjectId?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  teacherMembershipIds?: number[];
}

export class ListPeriodTimesQueryDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;
}

export class GeneratePeriodTimesDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek!: number[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  periodsCount!: number;

  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'firstPeriodStartsAt ต้องเป็นรูปแบบ HH:mm' })
  firstPeriodStartsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  periodLengthMinutes!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  breakAfterPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lunchAfterPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lunchMinutes?: number;
}

export class OverridePeriodTimeDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  period!: number;

  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'startsAt ต้องเป็นรูปแบบ HH:mm' })
  startsAt!: string;

  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'endsAt ต้องเป็นรูปแบบ HH:mm' })
  endsAt!: string;
}

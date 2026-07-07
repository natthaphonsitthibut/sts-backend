import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
  @Type(() => Number)
  @IsInt()
  teacherUserId?: number | null;
}

export class UpdateTimetableSlotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subjectId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teacherUserId?: number | null;
}

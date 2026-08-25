import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
const ATTENDANCE_SESSION_KIND_VALUES = ['SUBJECT'] as const;

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
}

export class GetRoomsQueryDto {
  @IsString()
  @IsNotEmpty()
  grade!: string;

  @IsOptional()
  @IsString()
  schoolId?: string;
}

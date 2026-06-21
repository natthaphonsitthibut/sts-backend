import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

const ATTENDANCE_STATUS_VALUES = ['P_PRESENT', 'P_ABSENT', 'P_LATE'] as const;

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
  @IsString()
  @IsNotEmpty()
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
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { STUDENT_ENROLLMENT_STATES } from '../students.types';

/** Page sizes the student list UI offers; keep in sync with the frontend control. */
export const STUDENT_PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_STUDENT_PAGE_SIZE = 20;

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
  searchTerm?: string;

  @IsOptional()
  @IsIn(STUDENT_ENROLLMENT_STATES)
  enrollmentState?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(STUDENT_PAGE_SIZES)
  limit?: number;
}

/** Scoped distinct grade/room options for the student-list filter dropdowns. */
export class GetStudentFilterOptionsQueryDto {
  @IsOptional()
  @IsString()
  schoolId?: string;

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
  grade?: string;

  @IsOptional()
  @IsIn(STUDENT_ENROLLMENT_STATES)
  enrollmentState?: string;
}

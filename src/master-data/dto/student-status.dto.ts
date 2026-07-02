import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  STUDENT_STATUS_CATEGORIES,
  STUDENT_STATUS_SORT_FIELDS,
  type StudentStatusCategory,
  type StudentStatusSortField,
} from '../student-status.types';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ListStudentStatusesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  searchTerm?: string;

  @IsOptional()
  @IsIn(STUDENT_STATUS_SORT_FIELDS)
  sortBy?: StudentStatusSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class CreateStudentStatusDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  code!: number;

  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  labelTh!: string;

  @IsIn(STUDENT_STATUS_CATEGORIES)
  category!: StudentStatusCategory;

  @IsBoolean()
  isActiveForLogin!: boolean;

  @IsBoolean()
  isTerminal!: boolean;

  @IsBoolean()
  requiresFollowup!: boolean;

  @IsBoolean()
  isEnabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(32767)
  sortOrder!: number;

  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sourceSystem!: string;
}

export class UpdateStudentStatusDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  labelTh?: string;

  @IsOptional()
  @IsIn(STUDENT_STATUS_CATEGORIES)
  category?: StudentStatusCategory;

  @IsOptional()
  @IsBoolean()
  isActiveForLogin?: boolean;

  @IsOptional()
  @IsBoolean()
  isTerminal?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresFollowup?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(32767)
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sourceSystem?: string;
}

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function positiveInteger(value: unknown): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return value;
}

export class CreateSubjectDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameTh!: string;
}

export class ListSchoolSubjectsQueryDto extends PaginationQueryDto {
  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  searchTerm?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class AddSchoolSubjectDto extends CreateSubjectDto {
  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  schoolId!: number;
}

export class UpdateSchoolSubjectDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}

export class ReplaceClassroomSubjectsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  schoolSubjectIds!: number[];
}

export class ListSubjectGradesQueryDto {
  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  termId?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class ListGradeSchoolSubjectsQueryDto extends PaginationQueryDto {
  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  termId!: number;

  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  gradeLevelId!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class SaveGradeSchoolSubjectDto extends AddSchoolSubjectDto {
  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  termId!: number;

  @Transform(({ value }: { value: unknown }) => positiveInteger(value))
  @IsInt()
  @Min(1)
  gradeLevelId!: number;

  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @ArrayMinSize(1, { message: 'กรุณาเลือกห้องเรียนอย่างน้อย 1 ห้อง' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  classroomIds!: number[];
}

import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ListSubjectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  searchTerm?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSubjectDto {
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
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

export class UpdateSubjectDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameTh?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

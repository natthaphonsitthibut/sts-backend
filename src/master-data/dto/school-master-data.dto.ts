import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

function trimOptionalText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateSchoolMasterDataDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @Transform(trimOptionalText)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  subDistrict?: string;
}

export class UpdateSchoolMasterDataDto {
  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  subDistrict?: string;
}

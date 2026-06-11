import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckSchoolsUploadDto {
  @IsString()
  @IsNotEmpty()
  mapping!: string;
}

export class BulkImportUploadDto {
  @IsString()
  @IsNotEmpty()
  target!: string;

  @IsString()
  @IsNotEmpty()
  mapping!: string;

  @IsOptional()
  @IsString()
  schools?: string;
}

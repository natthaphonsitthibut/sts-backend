import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PII_REASON_CODES } from '../pii-fields.config';

const EXPORT_REASON_CODES = PII_REASON_CODES.filter((code) => code !== 'SELF_ACCESS');

export class PiiExportScopeDto {
  @IsOptional()
  @IsBoolean()
  global?: boolean;

  @IsOptional()
  @IsArray()
  provinces?: string[];

  @IsOptional()
  @IsArray()
  districts?: string[];

  @IsOptional()
  @IsArray()
  sub_districts?: string[];

  @IsOptional()
  @IsArray()
  school_ids?: Array<number | string>;

  @IsOptional()
  @IsArray()
  grade_levels?: Array<number | string>;

  @IsOptional()
  @IsArray()
  room_ids?: Array<number | string>;
}

export class CreatePiiExportRequestDto {
  @IsObject()
  @ValidateNested()
  @Type(() => PiiExportScopeDto)
  scope!: PiiExportScopeDto;

  @IsOptional()
  @IsBoolean()
  include_full_national_id?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  selected_student_uuids?: string[];

  @IsIn(EXPORT_REASON_CODES)
  reason_code!: string;

  @IsString()
  @MaxLength(500)
  reason_note!: string;
}

export class ListPiiExportRequestsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'DOWNLOADED', 'EXPIRED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RejectPiiExportRequestDto {
  @IsString()
  @MaxLength(500)
  rejected_reason!: string;
}

export class DownloadPiiExportQueryDto {
  @IsString()
  token!: string;
}

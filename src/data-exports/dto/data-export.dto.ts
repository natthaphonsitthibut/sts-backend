import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type {
  DataExportCatalogItem,
  DataExportJobResponse,
  DataExportJobStatus,
} from '../data-export.types';

export class DataExportCatalogResponseDto {
  success!: true;
  data!: DataExportCatalogItem[];
}

export class CreateDataExportJobDto {
  @IsString()
  @MaxLength(64)
  datasetCode!: string;

  @IsString()
  @MaxLength(64)
  fieldBundleCode!: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  purposeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purposeNote?: string;
}

export class DataExportJobListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED'])
  status?: DataExportJobStatus;
}

export class DataExportJobResponseDto {
  success!: true;
  data!: DataExportJobResponse;
}

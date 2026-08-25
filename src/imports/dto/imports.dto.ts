import { Type } from 'class-transformer';
import {
  IsIn,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IMPORT_CATALOG_TARGETS } from '../import-catalog';
import { IMPORT_QUARANTINE_REASONS, type ImportQuarantineReason } from '../imports.types';

export class CheckSchoolsUploadDto {
  @IsString()
  @IsNotEmpty()
  mapping!: string;
}

export class BulkImportUploadDto {
  @IsString()
  @IsIn(IMPORT_CATALOG_TARGETS)
  target!: string;

  @IsString()
  @IsNotEmpty()
  mapping!: string;

  @IsOptional()
  @IsString()
  schools?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @ValidateIf((value: BulkImportUploadDto) => value.target !== 'school_teacher_membership')
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId?: number;

  @ValidateIf((value: BulkImportUploadDto) => value.target === 'student_term')
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

export class PreviewImportUploadDto {
  @IsString()
  @IsIn(IMPORT_CATALOG_TARGETS)
  target!: string;

  @IsString()
  @IsNotEmpty()
  mapping!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @ValidateIf((value: PreviewImportUploadDto) => value.target !== 'school_teacher_membership')
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId?: number;

  @ValidateIf((value: PreviewImportUploadDto) => value.target === 'student_term')
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

export interface SchoolRosterImportContext {
  schoolId?: number;
  schoolTermId?: number;
  classroomId?: number;
}

export class TeacherImportUploadDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;
}

export class ListImportQuarantineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsIn([10, 20, 50])
  limit = 20;

  @IsOptional()
  @IsIn(['PENDING', 'RESOLVED', 'REJECTED'])
  status?: 'PENDING' | 'RESOLVED' | 'REJECTED';

  @IsOptional()
  @IsIn(IMPORT_QUARANTINE_REASONS)
  reasonCode?: ImportQuarantineReason;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subDistrict?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;
}

export class ResolveImportQuarantineDto {
  @IsIn(['RESOLVE', 'REJECT'])
  action!: 'RESOLVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  candidateKey?: string;

  @ValidateIf(
    (value: ResolveImportQuarantineDto) => value.action === 'REJECT' || value.note !== undefined,
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ImportQuarantineValuesDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  AcademicYear_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  Semester_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  SchoolID_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  GradeLevelID_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  RoomID_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  StudentStatusID_Onec?: string;
}

export class FixImportQuarantineDto {
  @IsDefined()
  @Type(() => ImportQuarantineValuesDto)
  @ValidateNested()
  values!: ImportQuarantineValuesDto;
}

export class RetryImportQuarantineDto {
  @IsOptional()
  @IsIn(IMPORT_QUARANTINE_REASONS)
  reasonCode?: ImportQuarantineReason;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subDistrict?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;
}

export class ExportImportQuarantineDto {
  @IsOptional()
  @IsIn(['PENDING', 'RESOLVED', 'REJECTED'])
  status: 'PENDING' | 'RESOLVED' | 'REJECTED' = 'REJECTED';

  @IsOptional()
  @IsIn(IMPORT_QUARANTINE_REASONS)
  reasonCode?: ImportQuarantineReason;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subDistrict?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;
}

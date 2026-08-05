import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import type { ObservationConcernLevel } from '../student-observations.types';

const OBSERVATION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,47}$/;

function trimOptionalText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class StudentObservationPayloadDto {
  @Matches(OBSERVATION_CODE_PATTERN)
  dimensionCode!: string;

  @IsIn(['NOTE', 'WATCH', 'CONCERN'])
  concernLevel!: ObservationConcernLevel;

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(OBSERVATION_CODE_PATTERN, { each: true })
  tagCodes!: string[];

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  observedAt?: string;
}

export class CreateStudentObservationDto extends StudentObservationPayloadDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetableSlotId?: number;
}

export class UpdateStudentObservationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @Matches(OBSERVATION_CODE_PATTERN)
  dimensionCode?: string;

  @IsOptional()
  @IsIn(['NOTE', 'WATCH', 'CONCERN'])
  concernLevel?: ObservationConcernLevel;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(OBSERVATION_CODE_PATTERN, { each: true })
  tagCodes?: string[];

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  observedAt?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class ListStudentObservationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['NOTE', 'WATCH', 'CONCERN'])
  concernLevel?: ObservationConcernLevel;

  @IsOptional()
  @Matches(OBSERVATION_CODE_PATTERN)
  dimensionCode?: string;
}

export class PublicStudentObservationQueryDto extends ListStudentObservationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  /** Canonical UUID of one student_term enrollment snapshot. */
  @IsUUID()
  studentTermId!: string;
}

export class CreatePublicStudentObservationDto extends StudentObservationPayloadDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  /** Canonical UUID of one student_term enrollment snapshot. */
  @IsUUID()
  studentTermId!: string;
}

export class CreateTaskLinkStudentObservationDto extends StudentObservationPayloadDto {
  @IsUUID()
  studentTermId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetableSlotId?: number;
}

export class TaskLinkStudentObservationQueryDto extends PaginationQueryDto {
  @IsUUID()
  studentTermId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetableSlotId?: number;
}

export class UpdatePublicStudentObservationDto extends UpdateStudentObservationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  /** Canonical UUID of one student_term enrollment snapshot. */
  @IsUUID()
  studentTermId!: string;
}

export class PublicObservationRevisionsQueryDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  /** Canonical UUID of one student_term enrollment snapshot. */
  @IsUUID()
  studentTermId!: string;
}

export class UpdateObservationCatalogItemDto {
  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  labelTh?: string;

  @IsOptional()
  @IsBoolean()
  requiresComment?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

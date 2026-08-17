import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { HUMAN_RISK_DECISIONS, type HumanRiskDecision } from '../observation-reviews.types';

function trimText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ObservationSourceRefDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  observationId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision!: number;
}

export class CreateRiskReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsIn(HUMAN_RISK_DECISIONS)
  humanRiskDecision!: HumanRiskDecision;

  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  decisionReason!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ObservationSourceRefDto)
  sourceObservations!: ObservationSourceRefDto[];
}

export class ListTeacherObservationReportsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['NOTE', 'WATCH', 'CONCERN'])
  concernLevel?: 'NOTE' | 'WATCH' | 'CONCERN';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  searchTerm?: string;

  @IsOptional()
  @IsIn(['studentName', 'dimension', 'concernLevel', 'comment', 'author'])
  sortBy?: 'studentName' | 'dimension' | 'concernLevel' | 'comment' | 'author';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class ListTeacherWatchlistQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  searchTerm?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  subDistrict?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(50)
  grade?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(50)
  room?: string;
}

export class ObservationSourceResponseDto {
  observationId!: number;
  revision!: number;
}

export class ObservationReviewActorResponseDto {
  userId!: number;
  username!: string;
}

export class HumanRiskReviewResponseDto {
  id!: string;
  studentTermId!: string;
  schoolId!: number;
  calculatedAttendanceRisk!: string;
  teacherConcernSignal!: 'NONE' | 'WATCH' | 'CONCERN';
  humanRiskDecision!: HumanRiskDecision;
  decisionReason!: string;
  decidedBy!: ObservationReviewActorResponseDto;
  decidedAt!: string;
  revision!: number;
  sourceObservations!: ObservationSourceResponseDto[];
}

export class TeacherObservationReportResponseDto {
  reportKind!: 'OBSERVATION';
  reportId!: string;
  observationId!: string;
  observationRevision!: number;
  studentTermId!: string;
  studentName!: string;
  schoolId!: number;
  schoolName!: string;
  gradeLevelId!: number | null;
  gradeLabel!: string | null;
  classroomId!: string | null;
  roomNo!: number | null;
  authorDisplayName!: string;
  dimensionLabel!: string;
  concernLevel!: 'NOTE' | 'WATCH' | 'CONCERN';
  comment!: string | null;
  observedAt!: string;
}

export class TeacherWatchlistResponseDto {
  studentTermId!: string;
  studentName!: string;
  schoolId!: number;
  schoolName!: string;
  gradeLabel!: string | null;
  roomNo!: number | null;
  latestCommentId!: string;
  latestComment!: string;
  latestAuthorDisplayName!: string;
  latestCommentedAt!: string;
  commentCount!: number;
}

export class StudentClassroomCommentResponseDto {
  id!: string;
  studentTermId!: string;
  problemCategory!: string;
  problemCategoryLabel!: string;
  problemCategoryGuidance!: string | null;
  problemDescription!: string;
  authorDisplayName!: string;
  commentedAt!: string;
}

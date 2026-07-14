import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import {
  FOLLOW_UP_REVIEW_DECISIONS,
  FOLLOW_UP_URGENCIES,
  HUMAN_RISK_DECISIONS,
  type FollowUpReviewDecision,
  type FollowUpUrgency,
  type HumanRiskDecision,
} from '../observation-reviews.types';

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
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ObservationSourceRefDto)
  sourceObservations!: ObservationSourceRefDto[];
}

export class CreateFollowUpRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsIn(FOLLOW_UP_URGENCIES)
  urgency!: FollowUpUrgency;

  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ObservationSourceRefDto)
  sourceObservations!: ObservationSourceRefDto[];
}

export class ReviewFollowUpRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsIn(FOLLOW_UP_REVIEW_DECISIONS)
  decision!: FollowUpReviewDecision;

  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ListFollowUpRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId?: number;
}

export class PublicFollowUpRequestsQueryDto extends PaginationQueryDto {
  @IsUUID()
  studentTermId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;
}

export class CreatePublicFollowUpRequestDto extends CreateFollowUpRequestDto {
  @IsUUID()
  studentTermId!: string;
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

export class FollowUpReviewOutcomeResponseDto {
  decision!: FollowUpReviewDecision;
  reason!: string | null;
  reviewedBy!: ObservationReviewActorResponseDto;
  reviewedAt!: string;
}

export class FollowUpAssignmentResponseDto {
  taskId!: string;
  assignedBy!: ObservationReviewActorResponseDto;
  assignedAt!: string;
}

export class StudentFollowUpRequestResponseDto {
  id!: string;
  studentTermId!: string;
  schoolId!: number;
  requestType!: 'HOME_VISIT_CONSIDERATION';
  status!: 'PENDING_REVIEW' | FollowUpReviewDecision;
  urgency!: FollowUpUrgency;
  reason!: string;
  note!: string | null;
  requestedBy!: ObservationReviewActorResponseDto;
  assignmentId!: number;
  review!: FollowUpReviewOutcomeResponseDto | null;
  assignment!: FollowUpAssignmentResponseDto | null;
  revision!: number;
  sourceObservations!: ObservationSourceResponseDto[];
  createdAt!: string;
  updatedAt!: string;
}

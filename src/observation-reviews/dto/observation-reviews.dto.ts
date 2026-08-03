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
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ObservationSourceRefDto)
  sourceObservations!: ObservationSourceRefDto[];
}

export class CreateFollowUpRequestBaseDto {
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ObservationSourceRefDto)
  sourceObservations: ObservationSourceRefDto[] = [];
}

export class CreateFollowUpRequestDto extends CreateFollowUpRequestBaseDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId?: number;
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

export class ListHomeVisitRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['PENDING_REVIEW', 'APPROVED', 'REJECTED'])
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsIn(FOLLOW_UP_URGENCIES)
  urgency?: FollowUpUrgency;

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
  @IsIn(['studentName', 'reason', 'urgency', 'requester', 'status', 'caseStatus'])
  sortBy?: 'studentName' | 'reason' | 'urgency' | 'requester' | 'status' | 'caseStatus';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class PublicFollowUpRequestsQueryDto extends PaginationQueryDto {
  @IsUUID()
  studentTermId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;
}

export class CreatePublicFollowUpRequestDto extends CreateFollowUpRequestBaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

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

export class FollowUpCaseResponseDto {
  caseId!: number;
  status!: string;
}

export class StudentFollowUpRequestResponseDto {
  id!: string;
  studentTermId!: string;
  schoolId!: number;
  requestType!: 'HOME_VISIT_CONSIDERATION';
  status!: 'PENDING_REVIEW' | FollowUpReviewDecision | 'NEED_MORE_INFO';
  statusPresentation!: {
    labelTh: string;
    badgeVariant: string;
  };
  urgency!: FollowUpUrgency;
  reason!: string;
  note!: string | null;
  requestedBy!: ObservationReviewActorResponseDto;
  assignmentId!: number;
  review!: FollowUpReviewOutcomeResponseDto | null;
  assignment!: FollowUpAssignmentResponseDto | null;
  openedCase!: FollowUpCaseResponseDto | null;
  revision!: number;
  sourceObservations!: ObservationSourceResponseDto[];
  createdAt!: string;
  updatedAt!: string;
}

export class TeacherObservationReportResponseDto {
  reportKind!: 'FOLLOW_UP_REQUEST' | 'OBSERVATION';
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
  followUpRequestId!: string | null;
  followUpStatus!: 'PENDING_REVIEW' | FollowUpReviewDecision | null;
  urgency!: FollowUpUrgency | null;
  openedCaseId!: number | null;
  openedCaseStatus!: string | null;
}

export class TeacherWatchlistResponseDto {
  studentTermId!: string;
  studentName!: string;
  schoolId!: number;
  schoolName!: string;
  gradeLabel!: string | null;
  roomNo!: number | null;
  latestObservationId!: string;
  latestDimensionLabel!: string;
  latestConcernLevel!: 'NOTE' | 'WATCH' | 'CONCERN';
  latestComment!: string | null;
  latestAuthorDisplayName!: string;
  latestObservedAt!: string;
  observationCount!: number;
}

export class HomeVisitRequestReportResponseDto extends StudentFollowUpRequestResponseDto {
  student!: {
    studentTermId: string;
    displayName: string;
    schoolName: string;
    gradeLabel: string | null;
    roomNo: number | null;
  };
}

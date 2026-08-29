import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsISO8601,
  IsOptional,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Trims what a user typed without touching anything that is not a string. */
const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
import {
  CheckInStudentPhotoQueryDto,
  SubmitExceptionAttendanceDto,
} from '../../attendance/dto/exception-attendance.dto';
import {
  ListClassroomAttendanceHistoryDto,
  UpdateClassroomPresentationDto,
} from '../../school-structure/dto/school-structure.dto';

export class ListClassroomAttendanceLinksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'NOT_CREATED'])
  linkStatus?: 'ACTIVE' | 'INACTIVE' | 'NOT_CREATED';

  @IsOptional()
  @IsIn(['ASSIGNED', 'UNASSIGNED'])
  homeroomStatus?: 'ASSIGNED' | 'UNASSIGNED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class BulkCreateClassroomAttendanceLinksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsOptional()
  @IsBoolean()
  allTeachers?: boolean;

  @ValidateIf((dto: BulkCreateClassroomAttendanceLinksDto) => dto.allTeachers !== true)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  teacherMembershipIds?: number[];
}

export class ResendClassroomAttendanceLinkLineDto {
  /** Stable across transport retries so LINE can deduplicate this recipient. */
  @IsUUID('4')
  deliveryRequestId!: string;
}

export class ClassroomLineGroupInvitationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  expiresAt!: string;
}

export class GoogleCallbackDto {
  @IsString()
  @MaxLength(2048)
  code!: string;

  @IsString()
  @MaxLength(512)
  state!: string;
}

/**
 * Opening a case from the link. The student is the route parameter — the link
 * session decides which students exist at all — so only the reason travels in
 * the body. Same rules as `OpenCaseDto`, which the staff dialog posts.
 */
export class OpenClassroomLinkCaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class CreateAttendanceAssignmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;

  /** The lesson being handed on — an assignment covers one subject, not a room. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomSubjectId!: number;

  /**
   * When the link starts working. Omitted means immediately, which is what an
   * assignment created for today means.
   */
  @IsOptional()
  @IsISO8601()
  opensAt?: string;

  /** Required: an assignment with no end is a standing key, not a favour. */
  @IsISO8601()
  expiresAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The room a link request is about, when the link reaches more than one. */
export class ClassroomLinkRosterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

/**
 * A student photo, read through the link.
 *
 * The room comes with the request: a standing link reaches every room its
 * teacher's subjects touch, so there is no single room to infer from the
 * session, and the id is checked against that session before any bytes go out.
 */
export class ClassroomLinkStudentPhotoQueryDto extends CheckInStudentPhotoQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

/**
 * Submitting a register through the link. Same body as the staff route plus the
 * room, for the same reason the roster and the photo carry one: the session
 * reaches every room the teacher's subjects touch, so it cannot name one.
 */
export class SubmitClassroomLinkAttendanceDto extends SubmitExceptionAttendanceDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;
}

/** A teacher handing one of their own rooms on, from inside their link. */
export class CreateLinkAttendanceAssignmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomSubjectId!: number;

  @IsOptional()
  @IsISO8601()
  opensAt?: string;

  @IsISO8601()
  expiresAt!: string;
}

/**
 * The room whose history a link is asking for. Required even when the link
 * reaches only one room: the history is a read of a specific classroom, and
 * inferring it would let a wrong id fall through to whatever the session
 * happened to have.
 */
export class ListClassroomLinkAttendanceHistoryDto extends ListClassroomAttendanceHistoryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

/**
 * A cover change made from inside a link. The room is named in the body rather
 * than the path because the controller has to check it against the session
 * before anything is written.
 */
export class UpdateLinkClassroomPresentationDto extends UpdateClassroomPresentationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

/** Filters for the register of links a school has issued this term. */
export class ListIssuedClassroomLinksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsOptional()
  @IsIn(['TEACHER', 'ASSIGNMENT'])
  kind?: 'TEACHER' | 'ASSIGNMENT';

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

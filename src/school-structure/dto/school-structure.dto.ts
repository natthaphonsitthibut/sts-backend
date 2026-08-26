import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  CLASSROOM_STUDENT_PROBLEM_CATEGORIES,
  type ClassroomStudentProblemCategory,
  CLASSROOM_STUDENT_COMMENT_CONCERN_LEVELS,
  type ClassroomStudentCommentConcernLevel,
} from '../classroom-student-comment.constants';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListSchoolClassroomsDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['room', 'grade', 'students', 'homeroomTeacher'])
  sortBy?: 'room' | 'grade' | 'students' | 'homeroomTeacher';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class SetClassroomFavoriteDto {
  @IsBoolean()
  isFavorite!: boolean;
}

export class UpdateClassroomPresentationDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^#[0-9A-F]{6}$/)
  cardCoverColor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  coverImagePositionX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  coverImagePositionY?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(3)
  coverImageScale?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  removeCover?: boolean;
}

export class ListSchoolClassroomOptionsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;
}

export class CreateSchoolClassroomDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId!: number;

  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  @Matches(/^[1-9][0-9]*$/, { message: 'รหัสห้องต้องเป็นเลขจำนวนเต็มบวก' })
  roomCode!: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  roomName?: string;
}

export class UpdateSchoolClassroomDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  @Matches(/^[1-9][0-9]*$/, { message: 'รหัสห้องต้องเป็นเลขจำนวนเต็มบวก' })
  roomCode?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  roomName?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  classroomStatus?: 'ACTIVE' | 'INACTIVE';
}

export class ListSchoolTeachersDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  assignedToFilteredClassrooms?: boolean;

  @IsOptional()
  @IsIn(['name', 'status'])
  sortBy?: 'name' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class ListSchoolTeacherCandidatesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class CreateSchoolTeacherMembershipDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacherId!: number;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  startedOn?: string;
}

export class UpdateSchoolTeacherMembershipDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  membershipStatus!: 'ACTIVE' | 'INACTIVE';

  @ValidateIf((value: UpdateSchoolTeacherMembershipDto) => value.membershipStatus === 'INACTIVE')
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  endedOn?: string;
}

export class CreateClassroomTeacherAssignmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacherMembershipId!: number;

  @IsIn(['HOMEROOM', 'SUBJECT'])
  assignmentKind!: 'HOMEROOM' | 'SUBJECT';

  @ValidateIf((value: CreateClassroomTeacherAssignmentDto) => value.assignmentKind === 'SUBJECT')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subjectId?: number;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  effectiveOn?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  effectiveUntil?: string;
}

export class ListClassroomAssignmentsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class SetClassroomHomeroomTeachersDto {
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  teacherMembershipIds!: number[];
}

export class CreateClassroomStudentCommentDto {
  @IsIn(CLASSROOM_STUDENT_PROBLEM_CATEGORIES)
  problemCategory!: ClassroomStudentProblemCategory;

  @IsIn(CLASSROOM_STUDENT_COMMENT_CONCERN_LEVELS)
  concernLevelCode!: ClassroomStudentCommentConcernLevel;

  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  problemDescription!: string;
}

export class AuthorizeClassroomExportDto {
  @IsIn(['ROSTER', 'ATTENDANCE'])
  exportScope!: 'ROSTER' | 'ATTENDANCE';

  @IsIn(['pdf', 'xlsx', 'csv'])
  format!: 'pdf' | 'xlsx' | 'csv';

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  columns!: string[];

  @IsOptional()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  dateTo?: string;
}

export class ListClassroomRosterDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['HIGH', 'WATCH', 'NORMAL'])
  riskTier?: 'HIGH' | 'WATCH' | 'NORMAL';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId?: number;

  @IsOptional()
  @IsIn(['studentNumber', 'name', 'comment', 'status'])
  sortBy?: 'studentNumber' | 'name' | 'comment' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class ListClassroomAttendanceHistoryDto extends PaginationQueryDto {
  @IsIn(['DAILY', 'STUDENT'])
  view!: 'DAILY' | 'STUDENT';

  /** Narrows the history to one subject, so it reads like that teacher's own. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subjectId?: number;

  @IsOptional()
  @IsUUID()
  studentUuid?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  date?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  dateTo?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn([
    'date',
    'time',
    'recordedBy',
    'studentNumber',
    'name',
    'status',
    'present',
    'late',
    'leave',
    'absent',
  ])
  sortBy?:
    | 'date'
    | 'time'
    | 'recordedBy'
    | 'studentNumber'
    | 'name'
    | 'status'
    | 'present'
    | 'late'
    | 'leave'
    | 'absent';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

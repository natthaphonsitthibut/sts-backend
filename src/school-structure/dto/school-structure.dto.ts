import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

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
  @IsIn(['room', 'grade', 'students'])
  sortBy?: 'room' | 'grade' | 'students';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
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
  teacherUserId!: number;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  startedOn?: string;
}

export class UpdateSchoolTeacherMembershipDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  membershipStatus!: 'ACTIVE' | 'INACTIVE';

  @ValidateIf((value: UpdateSchoolTeacherMembershipDto) => value.membershipStatus === 'INACTIVE')
  @IsString()
  @Matches(ISO_DATE_PATTERN)
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
  effectiveOn?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN)
  effectiveUntil?: string;
}

export class ListClassroomAssignmentsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class ListClassroomRosterDto extends PaginationQueryDto {
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
  @IsIn(['name', 'status'])
  sortBy?: 'name' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

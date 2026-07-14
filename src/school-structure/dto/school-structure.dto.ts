import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListSchoolClassroomsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId?: number;
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
  @MaxLength(32)
  roomCode!: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  roomName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  legacyRoomNumber!: number;
}

export class UpdateSchoolClassroomDto {
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(120)
  roomName?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  classroomStatus?: 'ACTIVE' | 'INACTIVE';
}

export class ListSchoolTeachersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;
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

export class ListClassroomRosterDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;
}

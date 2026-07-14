import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  TEACHER_ACCESS_CAPABILITIES,
  type TeacherAccessCapability,
} from '../teacher-access.constants';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class IssueTeacherAccessGrantDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacherMembershipId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(TEACHER_ACCESS_CAPABILITIES, { each: true })
  capabilities!: TeacherAccessCapability[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignmentIds!: number[];

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

export class ListTeacherAccessGrantsDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolTermId?: number;

  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'REVOKED', 'EXPIRED', 'SUSPENDED'])
  status?: 'ALL' | 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED';
}

export class TeacherAccessAssignmentOptionsDto {
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
  teacherMembershipId!: number;
}

export class RevokeTeacherAccessGrantDto {
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class TeacherAccessTokenHeaderDto {
  @Transform(trimText)
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class TeacherAccessRosterQueryDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class TeacherAccessAttendanceRecordDto {
  @IsUUID()
  studentId!: string;

  @IsIn(['P_PRESENT', 'P_ABSENT', 'P_LATE'])
  status!: 'P_PRESENT' | 'P_ABSENT' | 'P_LATE';
}

export class SaveTeacherAccessAttendanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TeacherAccessAttendanceRecordDto)
  records!: TeacherAccessAttendanceRecordDto[];
}

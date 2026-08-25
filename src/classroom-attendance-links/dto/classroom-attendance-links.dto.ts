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
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

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
  allClassrooms?: boolean;

  @ValidateIf((dto: BulkCreateClassroomAttendanceLinksDto) => dto.allClassrooms !== true)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  classroomIds?: number[];
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

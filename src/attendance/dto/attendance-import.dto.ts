import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

/**
 * Either a multipart `file` part or a `url` is supplied; the controller rejects
 * the request when both are missing, because a DTO cannot see the upload.
 */
export class ParseAttendanceImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

export class ParsePublicAttendanceImportDto extends ParseAttendanceImportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId?: number;
}

/**
 * No `schoolId`/`schoolTermId`: the classroom already carries both, and reading
 * them from the request would let a caller file an import under a school they
 * are allowed to see while the class belongs to another one.
 */
export class RecordAttendanceImportDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  attendanceDate!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timetableSlotId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subjectId?: number;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  sourceUrl?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  rowCount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  appliedCount!: number;
}

export class ListAttendanceImportsDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomId!: number;

  /** Narrows the history to one subject, like the เช็กชื่อ tab's filter. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subjectId?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  attendanceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['attendanceDate', 'importedBy', 'importedAt'])
  sortBy?: 'attendanceDate' | 'importedBy' | 'importedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

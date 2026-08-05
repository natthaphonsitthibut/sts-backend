import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/pagination/pagination.dto';

export class ListCurriculumGradesQueryDto {
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
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class ListCurriculumSubjectsQueryDto extends PaginatedSearchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId!: number;
}

/**
 * One teacher and the classrooms they cover for this subject — the repeatable
 * "จัดสรรครูผู้สอน" block on the form.
 */
/**
 * One block of "these teachers cover these classrooms". A subject can be taught
 * by more than one teacher in the same room, so both sides are lists; the rows
 * stored underneath stay a flat teacher × classroom pairing either way.
 */
export class CurriculumTeacherAssignmentDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกครูผู้สอนอย่างน้อย 1 คน' })
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  teacherMembershipIds!: number[];

  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกห้องเรียนที่รับผิดชอบอย่างน้อย 1 ห้อง' })
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  classroomIds!: number[];
}

export class SaveCurriculumSubjectDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gradeLevelId!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : (value as unknown)))
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุรหัสวิชา' })
  @MaxLength(20)
  subjectCode!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : (value as unknown)))
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อวิชา' })
  @MaxLength(255)
  subjectName!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CurriculumTeacherAssignmentDto)
  teachers?: CurriculumTeacherAssignmentDto[];
}

export class UpdateCurriculumContentDto {
  // Multipart form fields arrive as strings.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  removeContent?: boolean;
}

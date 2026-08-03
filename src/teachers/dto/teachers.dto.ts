import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/pagination/pagination.dto';

/** Trim incoming text and turn a blank string into `undefined` (= "not provided"). */
function optionalText(): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value as unknown;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });
}

export class ListTeachersQueryDto extends PaginatedSearchQueryDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  teacherStatus?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsIn(['name', 'citizenId', 'phone', 'lineId', 'email'])
  sortBy?: 'name' | 'citizenId' | 'phone' | 'lineId' | 'email';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class CreateTeacherDto {
  @Type(() => Number)
  @IsInt()
  schoolId!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : (value as unknown)))
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อ' })
  @MaxLength(120)
  firstName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : (value as unknown)))
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุนามสกุล' })
  @MaxLength(120)
  lastName!: string;

  @IsOptional()
  @optionalText()
  @Matches(/^[0-9]{13}$/, { message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' })
  citizenId?: string;

  @IsOptional()
  @optionalText()
  @Matches(/^[0-9]{9,10}$/, { message: 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก' })
  phone?: string;

  @IsOptional()
  @optionalText()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @optionalText()
  @MaxLength(64)
  lineId?: string;
}

/**
 * School affiliation is changed by moving the membership, not by editing the
 * person, so `schoolId` is intentionally dropped from the update surface.
 */
export class UpdateTeacherDto extends PartialType(
  OmitType(CreateTeacherDto, ['schoolId'] as const),
) {}

export class UpdateTeacherPhotoDto {
  // Multipart form fields arrive as strings, so the checkbox value needs coercing
  // before @IsBoolean sees it.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  removePhoto?: boolean;
}

export class DeactivateTeacherDto {
  @IsOptional()
  @optionalText()
  @MaxLength(255)
  note?: string;
}

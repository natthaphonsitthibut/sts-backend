import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/pagination/pagination.dto';
import { ACCOUNT_LIFECYCLE_STATUSES } from '../users.types';
import type { AccountLifecycleStatus, DataScope } from '../users.types';

export const ACCOUNT_DEACTIVATION_REASON_CODES = [
  'STAFF_LEFT',
  'TRANSFERRED',
  'DUPLICATE',
  'SECURITY',
  'OTHER',
] as const;

export type AccountDeactivationReasonCode = (typeof ACCOUNT_DEACTIVATION_REASON_CODES)[number];

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

export class GetUsersQueryDto extends PaginatedSearchQueryDto {
  @IsOptional()
  @IsString()
  excludeRole?: string;

  @IsOptional()
  @IsIn(['name', 'role', 'affiliation'])
  sortBy?: 'name' | 'role' | 'affiliation';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  subDistrict?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  schoolId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gradeLevelId?: number;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsIn(ACCOUNT_LIFECYCLE_STATUSES)
  accountStatus?: AccountLifecycleStatus;
}

export class CreateUserDto {
  // FE echoes this on save; create/update services must use generated/path ids.
  @Allow()
  id?: unknown;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  @IsNotEmpty()
  FirstName!: string;

  @IsString()
  @IsNotEmpty()
  LastName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' })
  PersonID_Onec!: string;

  @IsOptional()
  @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  affiliation?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(64)
  line_id?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(255)
  address_line?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_village_no?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(150)
  address_street?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(150)
  address_soi?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(150)
  address_trok?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_sub_district?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_district?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_province?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @Matches(/^\d{5}$/, { message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' })
  address_postal_code?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  address_latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  address_longitude?: number | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsArray()
  permissions?: string[];

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsArray()
  roles?: string[];

  @IsOptional()
  @IsObject()
  data_scope?: DataScope;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class UpdateUserPhotoDto {
  // Multipart form fields arrive as strings, so the flag needs coercing before
  // @IsBoolean sees it.
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  removePhoto?: boolean;
}

function trimOptionalText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  FirstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  LastName?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก' })
  phone?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(255)
  affiliation?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(64)
  line_id?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(255)
  address_line?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_village_no?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(150)
  address_street?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(150)
  address_soi?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(150)
  address_trok?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_sub_district?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_district?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @IsString()
  @MaxLength(100)
  address_province?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimOptionalText(value))
  @Matches(/^\d{5}$/, { message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' })
  address_postal_code?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  address_latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  address_longitude?: number | null;
}

export class DeactivateUserAccountDto {
  @IsOptional()
  @IsIn(ACCOUNT_DEACTIVATION_REASON_CODES)
  reasonCode?: AccountDeactivationReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class CreateRoleGroupDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @Type(() => Number)
  @IsInt()
  rank!: number;

  @IsOptional()
  @IsArray()
  default_permissions?: string[];

  @IsOptional()
  @IsArray()
  permissions?: string[];

  @IsOptional()
  @IsString()
  scope_mode?: string;
}

export class UpdateRoleGroupDto extends PartialType(CreateRoleGroupDto) {}

export class RoleGroupListQueryDto extends PaginatedSearchQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @IsIn(['group', 'menus'])
  sortBy?: 'group' | 'menus';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

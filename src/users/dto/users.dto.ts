import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MinLength,
  Min,
} from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/pagination/pagination.dto';
import type { DataScope } from '../users.types';

export class GetUsersQueryDto extends PaginatedSearchQueryDto {
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

export class StudentAccountBulkFilterDto {
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
  @IsString()
  grade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  room?: number;

  @IsOptional()
  @Type(() => Boolean)
  onlyWithoutAccount?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class GenerateStudentAccountsDto extends StudentAccountBulkFilterDto {}

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
  @IsString()
  @IsNotEmpty()
  name!: string;

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

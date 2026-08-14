import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const GENDER_CODES = ['MALE', 'FEMALE', 'OTHER'] as const;

export class CreateAraIdRecordDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{13}$/)
  identityNumber!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  titleTh!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  givenNameTh!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  familyNameTh!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  givenNameEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  familyNameEn?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsIn(GENDER_CODES)
  genderCode?: (typeof GENDER_CODES)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  emailAddress?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subDistrictName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  districtName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provinceName?: string | null;

  @IsOptional()
  @Matches(/^\d{5}$/)
  postalCode?: string | null;

  @Matches(/^\d{8}$/)
  pin!: string;
}

export class UpdateAraIdRecordDto extends PartialType(CreateAraIdRecordDto) {}

export class ListAraIdRecordsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([10, 20, 50])
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  recordStatus?: 'ACTIVE' | 'INACTIVE';
}

export class UpdateAraIdRecordStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  recordStatus!: 'ACTIVE' | 'INACTIVE';
}

export class AraIdLoginDto {
  @Matches(/^\d{13}$/)
  identityNumber!: string;

  @Matches(/^\d{8}$/)
  pin!: string;
}

export class AraIdReauthenticateDto {
  @Matches(/^\d{8}$/)
  pin!: string;
}

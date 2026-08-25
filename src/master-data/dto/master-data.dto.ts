import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class ListMasterDataQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  searchTerm?: string;

  @IsOptional()
  @Transform(({ key, obj }) => {
    const value = (obj as Record<string, unknown>)[key];
    return value === true || value === 'true';
  })
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateCodedMasterDataDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  labelTh!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(32767)
  sortOrder!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  categoryCode?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  sourceOnecCode?: number | null;

  @IsOptional()
  @IsBoolean()
  requiresDetail?: boolean;
}

export class UpdateCodedMasterDataDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  labelTh?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(32767)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  categoryCode?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  sourceOnecCode?: number | null;

  @IsOptional()
  @IsBoolean()
  requiresDetail?: boolean;
}

export class CreateReferralAgencyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  agencyName!: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  agencyKindCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  websiteUrl?: string | null;
}

export class UpdateReferralAgencyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  agencyName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  agencyKindCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  websiteUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

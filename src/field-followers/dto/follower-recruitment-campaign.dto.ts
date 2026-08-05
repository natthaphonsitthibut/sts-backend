import {
  ArrayNotEmpty,
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DataScope } from '../../auth';

export class CreateFollowerRecruitmentCampaignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsObject()
  data_scope?: DataScope;

  @IsOptional()
  @IsDateString()
  opens_at?: string;

  @IsOptional()
  @IsDateString()
  closes_at?: string;
}

export class UpdateFollowerRecruitmentCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsObject()
  data_scope?: DataScope;

  // Absent (undefined) = leave the current value untouched. Clearing an
  // already-set window back to "no bound" isn't supported by this endpoint —
  // create a new campaign or set a bound far enough out instead.
  @IsOptional()
  @IsDateString()
  opens_at?: string;

  @IsOptional()
  @IsDateString()
  closes_at?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class AddFollowerCampaignTargetsDto {
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  case_ids!: number[];
}

export class AssignFollowerCampaignTargetDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  follower_id!: number;
}

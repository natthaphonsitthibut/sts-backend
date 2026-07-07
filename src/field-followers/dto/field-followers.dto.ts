import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const FIELD_FOLLOWER_STATUSES = ['APPLIED', 'VERIFIED', 'ACTIVE', 'SUSPENDED'] as const;
export type FieldFollowerStatus = (typeof FIELD_FOLLOWER_STATUSES)[number];

export const FIELD_FOLLOWER_REVIEW_ACTIONS = [
  'APPROVE',
  'REJECT',
  'SUSPEND',
  'REACTIVATE',
] as const;
export type FieldFollowerReviewAction = (typeof FIELD_FOLLOWER_REVIEW_ACTIONS)[number];

export class CreateFollowerApplicationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  first_name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  last_name!: string;

  @IsString()
  @MinLength(9)
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sub_district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  // Honeypot: a hidden field real users never see or fill. Bots that fill
  // every input trip this; a non-empty value silently drops the submission
  // (see FieldFollowersService#createApplication) without revealing the trap.
  @IsOptional()
  @IsString()
  website?: string;
}

export class ListFieldFollowersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(FIELD_FOLLOWER_STATUSES)
  status?: FieldFollowerStatus;

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
  @IsString()
  @MaxLength(100)
  searchTerm?: string;
}

export class ReviewFieldFollowerDto {
  @Type(() => String)
  @IsIn(FIELD_FOLLOWER_REVIEW_ACTIONS)
  action!: FieldFollowerReviewAction;
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { HomeDashboardPeriod } from '../home-dashboard.types';

export const HOME_DASHBOARD_PERIODS: HomeDashboardPeriod[] = ['7_DAYS', '30_DAYS', 'CURRENT_TERM'];

export class HomeDashboardQueryDto {
  @IsOptional()
  @IsIn(HOME_DASHBOARD_PERIODS)
  period?: HomeDashboardPeriod;

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
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

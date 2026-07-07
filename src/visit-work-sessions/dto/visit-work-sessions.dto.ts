import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class StartWorkSessionDto {
  @IsBoolean()
  consent!: boolean;
}

export const GUEST_WORK_SESSION_END_REASONS = ['MANUAL', 'SUBMITTED'] as const;
export type GuestWorkSessionEndReason = (typeof GUEST_WORK_SESSION_END_REASONS)[number];

export class EndWorkSessionDto {
  @IsOptional()
  @IsIn(GUEST_WORK_SESSION_END_REASONS)
  reason?: GuestWorkSessionEndReason;
}

export class ListWorkSessionMonitorQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  schoolId?: number;

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
  grade?: string;

  @IsOptional()
  @IsString()
  room?: string;
}

export class PositionPingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

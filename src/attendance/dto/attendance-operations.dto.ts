import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TERM_STATUS_VALUES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;

export class ListSchoolTermsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;
}

export class UpsertSchoolTermDto {
  /** Present when editing: the row to rewrite, even if the natural key changes. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  academicYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  semester!: number;

  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  startsOn!: string;

  @IsString()
  @Matches(ISO_DATE_PATTERN)
  @IsDateString({ strict: true })
  endsOn!: string;

  @IsString()
  @IsIn(TERM_STATUS_VALUES)
  status!: (typeof TERM_STATUS_VALUES)[number];
}

import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class GenerateObservationSummaryDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  sourceObservationIds?: string[];
}

export class ReviewObservationSummaryDto {
  @IsIn(['REVIEWED', 'REJECTED'])
  decision!: 'REVIEWED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

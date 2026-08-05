import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GeocodeQueryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;
}

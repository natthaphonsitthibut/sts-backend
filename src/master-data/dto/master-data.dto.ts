import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpsertMasterDataItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @ValidateIf((object: UpsertMasterDataItemDto) => !object.name)
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ValidateIf((object: UpsertMasterDataItemDto) => !object.label)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  legal_category?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  category_id?: number;
}

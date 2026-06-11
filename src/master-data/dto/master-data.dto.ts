import { ValidateIf, IsNotEmpty, IsString } from 'class-validator';

export class UpsertMasterDataItemDto {
  @ValidateIf((object: UpsertMasterDataItemDto) => !object.name)
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ValidateIf((object: UpsertMasterDataItemDto) => !object.label)
  @IsString()
  @IsNotEmpty()
  name?: string;
}

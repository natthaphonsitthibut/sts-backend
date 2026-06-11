import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @IsNotEmpty()
  value!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

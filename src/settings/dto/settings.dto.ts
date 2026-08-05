import { Allow, IsNotEmpty, IsString } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @IsNotEmpty()
  value!: string;

  // Legacy clients echo the description back; it is ignored — descriptions
  // come from the settings catalog, not from the client.
  @Allow()
  description?: string | null;
}

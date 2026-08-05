import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PII_REASON_CODES } from '../../students/pii-fields.config';

export class UserAddressRevealDto {
  @IsIn(PII_REASON_CODES.filter((code) => code !== 'SELF_ACCESS'))
  reason_code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason_note?: string;
}

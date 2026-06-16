import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PII_REASON_CODES, REVEALABLE_GROUPS } from '../pii-fields.config';

/**
 * Request to reveal one sensitive PII group for a student. `reason_note` is
 * optional here but REQUIRED when `reason_code` is OTHER — enforced in the
 * service against the central config (yields a 400).
 */
export class PiiRevealDto {
  @IsIn(REVEALABLE_GROUPS)
  field_group!: string;

  @IsIn(PII_REASON_CODES)
  reason_code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason_note?: string;
}

import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export const FIELD_MONITOR_MAP_MAX_STUDENTS = 50;

function splitCommaList(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class FieldMonitorMapQueryDto {
  // Explicit ids only — empty/missing (ArrayNotEmpty) or over the cap
  // (ArrayMaxSize) both 400. There must be no "return whole scope" mode.
  @Transform(({ value }) => splitCommaList(value))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(FIELD_MONITOR_MAP_MAX_STUDENTS)
  @IsUUID('4', { each: true })
  studentUuids!: string[];
}

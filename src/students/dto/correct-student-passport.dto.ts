import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CorrectStudentPassportDto {
  @Transform(trimText)
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุเลขหนังสือเดินทางใหม่' })
  @MaxLength(50)
  newPassportNumber!: string;
}

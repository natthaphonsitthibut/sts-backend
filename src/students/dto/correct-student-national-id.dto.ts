import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CorrectStudentNationalIdDto {
  @Transform(trimText)
  @IsString()
  @Matches(/^[0-9]{13}$/, {
    message: 'เลขบัตรประชาชนใหม่ต้องเป็นตัวเลข 13 หลัก',
  })
  newNationalId!: string;
}

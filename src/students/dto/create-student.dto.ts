import { OmitType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { UpdateStudentDto } from './update-student.dto';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateStudentDto extends OmitType(UpdateStudentDto, [
  'FirstName_Onec',
  'LastName_Onec',
  'student_status_code',
] as const) {
  @Transform(trimText)
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อ' })
  @MaxLength(100)
  FirstName_Onec!: string;

  @Transform(trimText)
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุนามสกุล' })
  @MaxLength(100)
  LastName_Onec!: string;

  @Transform(trimText)
  @IsString()
  @Matches(/^[0-9]{13}$/, {
    message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก',
  })
  PersonID_Onec!: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(50)
  PassportNumber_Onec?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroom_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_status_code!: number;
}

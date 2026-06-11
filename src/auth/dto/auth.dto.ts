import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class MockThaIdLoginDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{13}$/, {
    message: 'personId ต้องเป็นเลขบัตรประชาชน 13 หลัก',
  })
  personId!: string;
}

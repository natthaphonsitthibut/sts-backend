import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RequestTeacherLineOtpDto {
  @Transform(trimText)
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class VerifyTeacherLineOtpDto {
  @Transform(trimText)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(trimText)
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'รหัสยืนยันต้องเป็นตัวเลข 6 หลัก' })
  code!: string;
}

export class StartTeacherLineAuthorizationDto {
  @Transform(trimText)
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  token!: string;
}

/**
 * Query LINE puts on the callback. Both are optional at the DTO level because a
 * user who declines consent is redirected back with `error` and no `code`, and
 * that has to land on the result page rather than a validation error.
 */
export class TeacherLineCallbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;
}

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

function trimOptionalText({ value }: { value: unknown }): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const STUDENT_GUARDIAN_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN'] as const;
export type StudentGuardianRelation = (typeof STUDENT_GUARDIAN_RELATIONS)[number];

/** Student's own contact channels — persisted at canonical person level. */
export class StudentContactDto {
  @IsOptional()
  @Transform(trimOptionalText)
  @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก' })
  phone?: string | null;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email?: string | null;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(64)
  line_id?: string | null;
}

export class StudentGuardianInputDto {
  @IsIn(STUDENT_GUARDIAN_RELATIONS)
  relation!: StudentGuardianRelation;

  // Required for GUARDIAN (what the guardian actually is); cross-field rule is
  // enforced in the service so FATHER/MOTHER never carry a note.
  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(100)
  relation_note?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  full_name!: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก' })
  phone?: string | null;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email?: string | null;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(64)
  line_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  FirstName_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  MiddleName_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  LastName_Onec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_house_no?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  VillageNumber_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  Street_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  Soi_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  Trok_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ProvinceNameThai_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  DistrictNameThai_Onec?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  SubDistrictNameThai_Onec?: string | null;

  @IsOptional()
  @Matches(/^\d{5}$/, { message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' })
  PostalCode_Onec?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  address_latitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  address_longitude?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => StudentContactDto)
  contact?: StudentContactDto;

  // Full replacement of the guardian list (the form submits the whole set).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => StudentGuardianInputDto)
  guardians?: StudentGuardianInputDto[];
}

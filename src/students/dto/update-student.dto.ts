import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

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
}

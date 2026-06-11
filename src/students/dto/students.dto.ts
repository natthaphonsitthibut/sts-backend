import { IsOptional, IsString } from 'class-validator';

export class GetStudentsQueryDto {
  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsString()
  schoolId?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;
}

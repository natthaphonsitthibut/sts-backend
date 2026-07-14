import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class CreateCaseReportUpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(2000)
  summary!: string;
}

export class ListCaseReportUpsDto extends PaginationQueryDto {}

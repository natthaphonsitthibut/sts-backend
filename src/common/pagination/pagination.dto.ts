import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PAGE_SIZES } from './pagination.util';

/** Shared `page`/`limit` query params for paginated list endpoints. */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(PAGE_SIZES)
  limit?: number;
}

/** Pagination plus a free-text `searchTerm` for searchable list endpoints. */
export class PaginatedSearchQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  searchTerm?: string;
}

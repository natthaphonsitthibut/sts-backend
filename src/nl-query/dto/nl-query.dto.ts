import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const PREFERRED_CHART_TYPES = ['bar', 'line', 'pie', 'scatter'] as const;
export type PreferredChartType = (typeof PREFERRED_CHART_TYPES)[number];

export type SemanticType =
  | 'count'
  | 'number'
  | 'percent'
  | 'gpa'
  | 'date'
  | 'id'
  | 'category'
  | 'name'
  | 'text';

export interface QueryColumn {
  name: string;
  type: string;
  numeric: boolean;
  semantic_type: SemanticType;
}

export interface QueryEnvelope {
  status: 'ok' | 'error';
  request_id: string;
  question: string;
  sql: string | null;
  columns: QueryColumn[];
  rows: Record<string, unknown>[] | null;
  row_count: number;
  truncated: boolean;
  summary: {
    row_count: number;
    truncated: boolean;
    numeric_aggregates: Record<string, { sum?: number; min?: number; max?: number; mean?: number }>;
    single_value: boolean;
  } | null;
  visualization: {
    chart_type: PreferredChartType | 'table' | 'none';
    x_col: string | null;
    y_col: string | null;
    series_col: string | null;
    options: string[];
    title: string | null;
    x_label: string | null;
    y_label: string | null;
    top_n: number | null;
    reason: string | null;
  } | null;
  retry_count: number;
  elapsed_ms: number;
  error: { code: string; message: string } | null;
}

export interface SchemaResponse {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
  }>;
}

export class NlQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  @IsOptional()
  @IsIn(PREFERRED_CHART_TYPES)
  preferredChartType?: PreferredChartType;
}

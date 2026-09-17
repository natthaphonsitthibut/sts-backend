import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';

export const PREFERRED_CHART_TYPES = ['bar', 'line', 'pie', 'scatter'] as const;
export type PreferredChartType = (typeof PREFERRED_CHART_TYPES)[number];

export const ANSWER_TYPES = ['result', 'clarification', 'refusal'] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

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
  answer_type?: AnswerType;
  message: string | null;
  steps_used?: number;
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

@ValidatorConstraint({ name: 'sqlMatchesAnswerType', async: false })
class SqlMatchesAnswerTypeConstraint implements ValidatorConstraintInterface {
  validate(sql: unknown, args: ValidationArguments): boolean {
    const answerType = (args.object as PriorTurnDto).answerType;
    return answerType === 'result'
      ? typeof sql === 'string' && sql.length > 0
      : sql === null || sql === undefined;
  }

  defaultMessage(args: ValidationArguments): string {
    const answerType = (args.object as PriorTurnDto).answerType;
    return answerType === 'result'
      ? 'sql is required when answerType is result'
      : 'sql must be null when answerType is not result';
  }
}

export class PriorTurnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  @IsIn(ANSWER_TYPES)
  answerType!: AnswerType;

  @Validate(SqlMatchesAnswerTypeConstraint)
  sql?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  rowCount?: number | null;
}

export class NlQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  @IsOptional()
  @IsIn(PREFERRED_CHART_TYPES)
  preferredChartType?: PreferredChartType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PriorTurnDto)
  history?: PriorTurnDto[];
}

import type {
  ExecutiveReportingPolicy,
  ResolveExecutiveReportingPolicyInput,
} from './executive-reporting.types';

export const EXECUTIVE_REPORTING_POLICY = Symbol('EXECUTIVE_REPORTING_POLICY');

const NON_PRODUCTION_FALLBACK_MINIMUM_CELL_SIZE = 5;

export function resolveExecutiveReportingPolicy(
  input: ResolveExecutiveReportingPolicyInput,
): ExecutiveReportingPolicy {
  if (
    typeof input.minimumCellSize === 'number' &&
    Number.isInteger(input.minimumCellSize) &&
    input.minimumCellSize >= 2
  ) {
    return { minimumCellSize: input.minimumCellSize };
  }

  if (input.environment !== 'production') {
    return { minimumCellSize: NON_PRODUCTION_FALLBACK_MINIMUM_CELL_SIZE };
  }

  throw new Error(
    'Executive reporting minimum cell size must be explicitly configured in production',
  );
}

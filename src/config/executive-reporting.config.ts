import { registerAs } from '@nestjs/config';
import type { ResolveExecutiveReportingPolicyInput } from '../executive-reporting/executive-reporting.types';

function parseMinimumCellSize(value: string | undefined): number | null {
  const parsed = Number.parseInt(value?.trim() ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 2 ? parsed : null;
}

function parseEnvironment(
  value: string | undefined,
): ResolveExecutiveReportingPolicyInput['environment'] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'production' || normalized === 'test') return normalized;
  return 'development';
}

export const executiveReportingConfig = registerAs('executiveReporting', () => ({
  environment: parseEnvironment(process.env.NODE_ENV),
  minimumCellSize: parseMinimumCellSize(process.env.EXECUTIVE_REPORTING_MINIMUM_CELL_SIZE),
}));

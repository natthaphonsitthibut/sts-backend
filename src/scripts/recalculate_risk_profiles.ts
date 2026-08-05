import 'reflect-metadata';
import appDataSource from '../database/typeorm.datasource';
import { RiskProfileRepository } from '../risk-profile/risk-profile.repository';

/**
 * One-off full recalculation of `student_risk_profiles`, for when the tier
 * rules themselves change and every row has to be re-scored immediately
 * instead of waiting for the daily safety-net pass. Talks to the repository
 * directly, so it needs no Redis/queue — the drain path stays untouched.
 */
async function main(): Promise<void> {
  await appDataSource.initialize();
  try {
    const repository = new RiskProfileRepository(appDataSource);
    const thresholds = await repository.getRiskThresholds();
    const startedAt = Date.now();
    const result = await repository.recalculateAll(thresholds);
    console.log(
      `Risk profile full recalculation: evaluated=${result.evaluated}, changed=${result.changed}, skipped=${result.skipped}, highAbsentDays=${thresholds.highAbsentDays}, durationMs=${Date.now() - startedAt}`,
    );
    const distribution: Array<{ risk_tier: string; count: number }> = await appDataSource.query(
      'SELECT risk_tier, COUNT(*)::int AS count FROM student_risk_profiles GROUP BY 1 ORDER BY 1',
    );
    for (const row of distribution) {
      console.log(`  ${row.risk_tier}: ${row.count}`);
    }
  } finally {
    await appDataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

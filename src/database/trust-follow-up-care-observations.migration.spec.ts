import type { QueryRunner } from 'typeorm';
import { TrustFollowUpCareObservations20260827312700 } from './migrations/20260827312700-TrustFollowUpCareObservations';

describe('TrustFollowUpCareObservations20260827312700', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new TrustFollowUpCareObservations20260827312700()[direction](runner);
    return statements.join('\n');
  };

  it('promotes existing observations then removes the review state', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('INSERT INTO student_term_disadvantages');
    expect(sql).toContain('INSERT INTO student_disabilities');
    expect(sql).toContain('DROP COLUMN IF EXISTS verification_status');
    expect(sql).toContain('idx_home_visit_disadvantage_observations_type_observed');
    expect(sql).toContain('idx_home_visit_disability_observations_type_observed');
  });

  it('never promotes an observation a reviewer already refused', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain("observation.verification_status <> 'REJECTED'");
    expect(sql).toContain(
      "DELETE FROM home_visit_disadvantage_observations WHERE verification_status = 'REJECTED'",
    );
    expect(sql).toContain(
      "DELETE FROM home_visit_disability_observations WHERE verification_status = 'REJECTED'",
    );
  });

  it('restores a valid approved review shape on rollback', async () => {
    const sql = await collectSql('down');
    expect(sql).toContain("verification_status VARCHAR(20) NOT NULL DEFAULT 'APPROVED'");
    expect(sql).toContain('SET reviewed_at = observed_at');
    expect(sql).toContain('fk_home_visit_disadvantage_observations_reviewer');
  });
});

import type { QueryRunner } from 'typeorm';
import { ReconcileHomeDashboardData20260827295000 } from './migrations/20260827295000-ReconcileHomeDashboardData';

describe('ReconcileHomeDashboardData20260827295000', () => {
  async function collect(direction: 'up' | 'down'): Promise<string> {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new ReconcileHomeDashboardData20260827295000()[direction](runner);
    return statements.join('\n');
  }

  it('repairs and secures current enrollment while reconciling only proven legacy cases', async () => {
    const sql = await collect('up');

    expect(sql).toContain('WITH (security_invoker = true) AS');
    expect(sql).toContain("status_category = 'STUDYING'");
    expect(sql).toContain("status_category = 'UNMATCHED'");
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE student_current_enrollment_resolution FROM %I',
    );
    expect(sql).toContain('CREATE TABLE home_dashboard_category_reconcile_20260824_backup');
    expect(sql).toContain('tracked_case.id = ANY($1::integer[])');
    expect(sql).toContain("submission.case_follow_up_decision = 'REQUEST_REVIEW'");
    expect(sql).toContain("review.review_action = 'CLOSE'");
    expect(sql).toContain("SET follow_up_problem_category_code = 'OTHER'");
  });

  it('restores only recorded backfills and the pre-rename view predicate', async () => {
    const sql = await collect('down');

    expect(sql).toContain('home_dashboard_category_reconcile_20260824_backup backup');
    expect(sql).toContain('SET follow_up_problem_category_code = NULL');
    expect(sql).toContain("submission.follow_up_problem_category_code = 'OTHER'");
    expect(sql).toContain("status_category = 'ACTIVE'");
    expect(sql).toContain("status_category = 'UNMAPPED'");
    expect(sql).toContain('WITH (security_invoker = true) AS');
  });
});

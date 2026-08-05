import { AddCaseReportUps20260714250000 } from '../database/migrations/20260714250000-AddCaseReportUps';

describe('AddCaseReportUps20260714250000', () => {
  it('backfills every distinct legacy-case signal and reconciles without purging referral data', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    };

    await new AddCaseReportUps20260714250000().up(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain("WHERE status = 'AWAITING_HELP'");
    expect(sql).toContain("UPPER(review.review_action) = 'FORWARD'");
    expect(sql).toContain('FROM case_referrals referral');
    expect(sql).toContain("audit.action = 'CASE_FORWARD'");
    expect(sql).toContain('SELECT DISTINCT legacy.case_id');
    expect(sql).toContain('case report-up backfill mismatch');
    expect(sql).toContain('school_id INTEGER NOT NULL');
    expect(sql).toContain("WHERE name IN ('ADMIN', 'ADMIN_SCHOOL', 'DIRECTOR')");
    expect(sql).toContain("SET status = 'REPORTED_UP'");
    expect(sql).not.toMatch(/DROP TABLE (case_referrals|external_agencies|related_agencies)/);
    expect(sql).not.toMatch(/DELETE FROM (case_referrals|external_agencies|related_agencies)/);
  });

  it('provides a structural rollback to the compatibility status', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    };

    await new AddCaseReportUps20260714250000().down(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain("SET status = 'AWAITING_HELP'");
    expect(sql).toContain('DROP TABLE case_report_ups');
    expect(sql).toContain("DELETE FROM case_workflow_statuses WHERE code = 'REPORTED_UP'");
  });
});

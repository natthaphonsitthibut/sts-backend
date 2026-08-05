import type { QueryRunner } from 'typeorm';
import { AlignCaseTrackingWorkflow20260720120000 } from './migrations/20260720120000-AlignCaseTrackingWorkflow';

describe('AlignCaseTrackingWorkflow20260720120000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AlignCaseTrackingWorkflow20260720120000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('moves retired states and report-up history into the tracking workflow', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain("('CONTINUE', 'ติดตามต่อ', 'IN_PROGRESS'");
    expect(sql).toContain("('REQUEST_REVIEW', 'ส่งให้ตรวจผล', 'PENDING_REVIEW'");
    expect(sql).toContain("('CLOSE_CASE', 'ปิดเคส', 'RESOLVED'");
    expect(sql).toContain("WHERE status IN ('REPORTED_UP', 'AWAITING_HELP')");
    expect(sql).toContain('CREATE TABLE case_tracking_report_up_backup_20260720');
    expect(sql).toContain('FOREIGN KEY (case_id) REFERENCES cases(id)');
    expect(sql).toContain('FOREIGN KEY (school_id) REFERENCES schools(id)');
    expect(sql).toContain('FOREIGN KEY (reported_by) REFERENCES users(id)');
    expect(sql).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
    expect(sql).toContain('FROM case_report_ups');
    expect(sql).toContain('FROM case_report_ups report_up');
    expect(sql).toContain("permission <> 'report-up-cases'");
    expect(sql).toContain('DROP TABLE case_report_ups');
  });

  it('adds explicit foreign keys and a reconciled submission decision constraint', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('FOREIGN KEY (review_action) REFERENCES case_review_actions(code)');
    expect(sql).toContain(
      'FOREIGN KEY (case_follow_up_decision) REFERENCES case_follow_up_decisions(code)',
    );
    expect(sql).toContain(
      "case_follow_up_decision = 'CLOSE_CASE' AND case_resolution_outcome_code IS NOT NULL",
    );
    expect(sql).toContain('case tracking status reconciliation failed');
  });

  it('restores exact legacy report rows and permission snapshots on rollback', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('FROM case_tracking_report_up_backup_20260720');
    expect(sql).toContain('SET status = backup.previous_status');
    expect(sql).toContain('SET default_permissions = backup.default_permissions');
    expect(sql).toContain('SET permissions = backup.permissions');
    expect(sql).toContain('DROP TABLE case_tracking_report_up_backup_20260720');
  });
});

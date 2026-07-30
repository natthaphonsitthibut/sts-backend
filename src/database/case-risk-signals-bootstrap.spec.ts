import { CASE_TRACKING_DECISION_TABLES_SQL } from './bootstrap-sql';

describe('case risk signal bootstrap SQL', () => {
  it('fails before deleting legacy reviews when the move is not lossless', () => {
    expect(CASE_TRACKING_DECISION_TABLES_SQL).toContain('HAVING COUNT(*) > 1');
    expect(CASE_TRACKING_DECISION_TABLES_SQL).toContain(
      'subject-risk review conflicts with an existing risk signal',
    );
    expect(CASE_TRACKING_DECISION_TABLES_SQL).toContain(
      'subject-risk bootstrap reconciliation failed',
    );
    expect(CASE_TRACKING_DECISION_TABLES_SQL).toContain('ON CONFLICT (id) DO NOTHING');
    expect(CASE_TRACKING_DECISION_TABLES_SQL).not.toContain(
      'ON CONFLICT (case_id, signal_source_code, signal_reason) DO NOTHING',
    );
  });
});

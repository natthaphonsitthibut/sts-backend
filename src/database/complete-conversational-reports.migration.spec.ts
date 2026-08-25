import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CompleteConversationalReports migration', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/database/migrations/20260827307000-CompleteConversationalReports.ts'),
    'utf8',
  );

  it('adds optional bounded outcome detail and repeat-round lookup indexes', () => {
    expect(source).toContain('ADD COLUMN execution_outcome_detail TEXT');
    expect(source).toContain('ADD COLUMN contact_person_name VARCHAR(200)');
    expect(source).toContain('ADD COLUMN contact_channel_code VARCHAR(24)');
    expect(source).toContain("'IN_PERSON', 'PHONE', 'LINE', 'OTHER'");
    expect(source).toContain('length(btrim(execution_outcome_detail)) BETWEEN 1 AND 2000');
    expect(source).toContain('idx_tasks_case_round_history');
    expect(source).toContain('idx_task_submissions_link_submitted');
  });

  it('opens ASSIST to repeat rounds and guards destructive rollback', () => {
    expect(source).toContain('SET available_phase_code = NULL');
    expect(source).toContain("SET available_phase_code = 'FOLLOW_UP'");
    expect(source).toContain('cannot drop execution_outcome_detail while report detail exists');
    expect(source).toContain('rollback refused');
  });
});

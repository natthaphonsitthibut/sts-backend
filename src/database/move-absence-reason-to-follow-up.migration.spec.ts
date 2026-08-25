import type { QueryRunner } from 'typeorm';
import { MoveAbsenceReasonToFollowUp20260827312500 } from './migrations/20260827312500-MoveAbsenceReasonToFollowUp';

describe('MoveAbsenceReasonToFollowUp20260827312500', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new MoveAbsenceReasonToFollowUp20260827312500()[direction](runner);
    return statements.join('\n');
  };

  it('adds the nullable follow-up FK and partial reporting index', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('ADD COLUMN absence_reason_code VARCHAR(40) NULL');
    expect(sql).toContain('REFERENCES absence_reasons(code) ON UPDATE CASCADE ON DELETE RESTRICT');
    expect(sql).toContain('idx_task_submissions_absence_reason_submitted');
    expect(sql).toContain('WHERE absence_reason_code IS NOT NULL AND deleted_at IS NULL');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_attendance_exceptions_absence_reason');
    expect(sql).toContain('DROP COLUMN IF EXISTS absence_reason_code');
  });

  it('removes only the additive follow-up structures on rollback', async () => {
    const sql = await collectSql('down');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_task_submissions_absence_reason_submitted');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS fk_task_submissions_absence_reason');
    expect(sql).toContain('DROP COLUMN IF EXISTS absence_reason_code');
    expect(sql).toContain("SET absence_reason_code = 'UNKNOWN'");
    expect(sql).toContain('CREATE INDEX idx_attendance_exceptions_absence_reason');
  });
});

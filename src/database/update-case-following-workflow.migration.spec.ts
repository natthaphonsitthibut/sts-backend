import type { QueryRunner } from 'typeorm';
import { UpdateCaseFollowingWorkflow20260802120000 } from './migrations/20260802120000-UpdateCaseFollowingWorkflow';

describe('UpdateCaseFollowingWorkflow20260802120000', () => {
  it('adds terminal outcomes, backfills resolved cases, and replaces active review actions', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new UpdateCaseFollowingWorkflow20260802120000().up(queryRunner);
    const sql = statements.join('\n');

    expect(sql).toContain("('STUDENT_NOT_FOUND', 'ไม่พบนักเรียน'");
    expect(sql).toContain('CREATE TABLE case_completion_outcomes');
    expect(sql).toContain("('CLOSED', 'ปิดเคส', 10)");
    expect(sql).toContain("('REFERRED_AGENCY', 'ส่งต่อหน่วยงาน', 20)");
    expect(sql).toContain("WHERE status = 'RESOLVED' AND completion_outcome_code IS NULL");
    expect(sql).toContain("WHERE code = 'CONTINUE'");
    expect(sql).toContain("'REFER_AGENCY', 'ส่งต่อหน่วยงาน', 'RESOLVED', 'REFERRED_AGENCY'");
  });
});

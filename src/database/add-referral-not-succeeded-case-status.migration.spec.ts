import type { QueryRunner } from 'typeorm';
import { AddReferralNotSucceededCaseStatus20261012110000 } from './migrations/20261012110000-AddReferralNotSucceededCaseStatus';

describe('AddReferralNotSucceededCaseStatus20261012110000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddReferralNotSucceededCaseStatus20261012110000()[direction](runner);
    return statements;
  };

  it('adds ส่งต่อไม่สำเร็จ as a case status that still counts as an open case', async () => {
    const statements = await collectSql('up');
    expect(statements.join('\n')).toContain(
      "('REFERRAL_NOT_SUCCEEDED', 'ส่งต่อไม่สำเร็จ', 'destructive', 27)",
    );
    const index = statements.find((sql) =>
      sql.startsWith('CREATE UNIQUE INDEX uq_cases_active_student_uuid'),
    );
    expect(index).toContain("'REFERRAL_NOT_SUCCEEDED'");
    expect(index).toContain("'AWAITING_REFERRAL_OUTCOME'");
    expect(index).toContain("'STUDENT_NOT_FOUND'");
  });

  it('moves only cases resting in รอพิจารณา on their newest, unsuccessful referral', async () => {
    const statements = await collectSql('up');
    const move = statements.find((sql) => sql.startsWith('UPDATE cases c'));
    expect(move).toContain("SET status = 'REFERRAL_NOT_SUCCEEDED'");
    expect(move).toContain("failed.status_code = 'NOT_SUCCEEDED'");
    expect(move).toContain("c.status = 'PENDING_REVIEW'");
    expect(move).toContain('(newer.referred_at, newer.id) > (failed.referred_at, failed.id)');
    expect(move).toContain('later_task.created_at > failed.referred_at');
  });

  it('returns cases and notifications to รอพิจารณา before dropping the status', async () => {
    const statements = await collectSql('down');
    expect(statements[0]).toContain(
      "UPDATE cases SET status = 'PENDING_REVIEW' WHERE status = 'REFERRAL_NOT_SUCCEEDED'",
    );
    expect(statements[1]).toContain(
      "UPDATE notifications SET case_status_code = 'PENDING_REVIEW' WHERE case_status_code = 'REFERRAL_NOT_SUCCEEDED'",
    );
    const index = statements.find((sql) =>
      sql.startsWith('CREATE UNIQUE INDEX uq_cases_active_student_uuid'),
    );
    expect(index).not.toContain('REFERRAL_NOT_SUCCEEDED');
    expect(statements.at(-1)).toBe(
      "DELETE FROM case_workflow_statuses WHERE code = 'REFERRAL_NOT_SUCCEEDED'",
    );
  });
});

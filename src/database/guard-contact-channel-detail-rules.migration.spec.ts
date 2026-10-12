import type { QueryRunner } from 'typeorm';
import { GuardContactChannelDetailRules20261012150000 } from './migrations/20261012150000-GuardContactChannelDetailRules';

describe('GuardContactChannelDetailRules20261012150000', () => {
  it('locks the catalog when writing detail and guards disabling used rules', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new GuardContactChannelDetailRules20261012150000().up(runner);
    const sql = statements.join(' ');
    expect(sql).toContain('FOR SHARE');
    expect(sql).toContain('OLD.requires_detail AND NOT NEW.requires_detail');
    expect(sql).toContain('BEFORE UPDATE OF requires_detail');
    expect(sql).toContain('WHERE contact_channel_detail IS NOT NULL');
  });

  it('removes only the guards and restores the preceding submission validator', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new GuardContactChannelDetailRules20261012150000().down(runner);
    const sql = statements.join(' ');
    expect(sql).toContain('DROP TRIGGER trg_contact_channel_options_saved_details');
    expect(sql).toContain('DROP INDEX idx_task_submissions_contact_detail_channel');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION enforce_task_submission_contact_channel_detail()',
    );
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|DROP COLUMN/);
  });
});

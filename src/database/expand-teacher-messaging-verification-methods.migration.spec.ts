import type { QueryRunner } from 'typeorm';
import { ExpandTeacherMessagingVerificationMethods20260827312100 } from './migrations/20260827312100-ExpandTeacherMessagingVerificationMethods';

describe('ExpandTeacherMessagingVerificationMethods20260827312100', () => {
  it('hard-deletes OTP bindings and accepts only Google or AraID afterward', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new ExpandTeacherMessagingVerificationMethods20260827312100().up(runner);

    const sql = statements.join('\n');
    expect(sql).toContain(
      "DELETE FROM teacher_messaging_accounts WHERE verified_via = 'EMAIL_OTP'",
    );
    expect(sql).toContain("CHECK (verified_via IN ('GOOGLE', 'ARAID'))");
    expect(sql).not.toContain('LEGACY_REVOKED');
    expect(sql).not.toContain('LEGACY_DELETED');
  });

  it('refuses a rollback that would pretend hard-deleted OTP bindings can be restored', async () => {
    await expect(
      new ExpandTeacherMessagingVerificationMethods20260827312100().down({}),
    ).rejects.toThrow('pre-migration database backup');
  });
});

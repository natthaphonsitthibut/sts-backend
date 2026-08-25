import type { QueryRunner } from 'typeorm';
import { SeedReferralAgencyDirectory20260827305000 } from './migrations/20260827305000-SeedReferralAgencyDirectory';

describe('SeedReferralAgencyDirectory20260827305000', () => {
  it('guards prerequisites and exact-name collisions before inserting official agencies', async () => {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;

    await new SeedReferralAgencyDirectory20260827305000().up(runner);

    const statements = query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("to_regclass('public.referral_agencies')");
    expect(statements[0]).toContain('baseline collides with an existing exact name');
    expect(statements[1]).toContain('กรมส่งเสริมการเรียนรู้');
    expect(statements[1]).toContain('สถาบันสุขภาพเด็กแห่งชาติมหาราชินี');
    expect(statements[1]).toContain('มูลนิธิศูนย์พิทักษ์สิทธิเด็ก');
    expect(statements[1]).toContain('กรมกิจการเด็กและเยาวชน');
    expect(statements[2]).toContain('did not converge to four active rows');
  });

  it('removes only the seeded directory and refuses when referral history exists', async () => {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;

    await new SeedReferralAgencyDirectory20260827305000().down(runner);

    const statement = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(statement).toContain('referral history uses the seeded directory');
    expect(statement).toContain('DELETE FROM referral_agencies');
    expect(query.mock.calls[0]).toHaveLength(1);
  });
});

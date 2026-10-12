import type { QueryRunner } from 'typeorm';
import {
  studentCurrentEnrollmentViewSql,
  STUDENT_CURRENT_ENROLLMENT_VIEW_SQL,
} from './bootstrap-sql';
import { DeferDraftEnrollmentResolution20261011103000 } from './migrations/20261011103000-DeferDraftEnrollmentResolution';

describe('DeferDraftEnrollmentResolution migration', () => {
  it('keeps current-enrollment status and ambiguity guards after excluding drafts', async () => {
    const query = jest.fn<Promise<unknown[]>, [string]>().mockResolvedValue([]);
    await new DeferDraftEnrollmentResolution20261011103000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls[0][0];
    expect(sql).toBe(STUDENT_CURRENT_ENROLLMENT_VIEW_SQL);
    expect(sql).toContain('enrollment_term.id = enrollment.school_term_id');
    expect(sql).toContain('enrollment_term.school_id = enrollment."SchoolID_Onec"');
    expect(sql).toContain("enrollment_term.status IS DISTINCT FROM 'DRAFT'");
    expect(sql).toContain("THEN 'STATUS_UNRESOLVED'");
    expect(sql).toContain("THEN 'AMBIGUOUS_ACTIVE'");
    expect(sql).toContain('WITH (security_invoker = true)');
  });
  it('restores previous latest-enrollment behavior on rollback', async () => {
    const query = jest.fn<Promise<unknown[]>, [string]>().mockResolvedValue([]);
    await new DeferDraftEnrollmentResolution20261011103000().down({
      query,
    } as unknown as QueryRunner);
    expect(query.mock.calls[0][0]).toBe(studentCurrentEnrollmentViewSql('STUDYING', 'UNMATCHED'));
    expect(query.mock.calls[0][0]).not.toContain('enrollment_term.status');
  });
});

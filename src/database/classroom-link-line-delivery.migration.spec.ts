import type { QueryRunner } from 'typeorm';
import { AddClassroomLinkLineDelivery20260827210000 } from './migrations/20260827210000-AddClassroomLinkLineDelivery';

describe('AddClassroomLinkLineDelivery20260827210000', () => {
  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddClassroomLinkLineDelivery20260827210000()[direction](runner);
    return statements.join('\n');
  };

  it('adds constrained delivery state with a real membership FK', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('ADD COLUMN line_delivery_teacher_membership_id BIGINT');
    expect(sql).toContain('ADD COLUMN line_delivery_status VARCHAR(16) NOT NULL');
    expect(sql).toContain(
      'FOREIGN KEY (line_delivery_teacher_membership_id, school_id) REFERENCES school_teacher_memberships(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain("'NOT_READY', 'SENDING', 'SENT', 'FAILED', 'NEEDS_RESEND'");
    expect(sql).toContain('CHECK (line_delivery_attempt_count >= 0)');
    expect(sql).toContain('CREATE INDEX idx_classroom_attendance_links_line_delivery');
  });

  it('keeps readiness and provider failures as closed vocabularies', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain("'HOMEROOM_UNAVAILABLE'");
    expect(sql).toContain("'ACCOUNT_NOT_VERIFIED'");
    expect(sql).toContain("'ACCOUNT_NOT_REACHABLE'");
    expect(sql).toContain("'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE'");
    expect(sql).toContain("line_delivery_status = 'SENT'");
    expect(sql).toContain('line_delivered_at >= line_delivery_last_attempted_at');
  });

  it('refuses to drop delivery columns after consumer writes', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('Refusing rollback: classroom link LINE delivery contains consumer data');
    expect(sql).toContain('DROP CONSTRAINT fk_classroom_attendance_links_line_delivery_membership');
    expect(sql).toContain('DROP COLUMN line_delivery_teacher_membership_id');
  });
});

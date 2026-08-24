import type { QueryRunner } from 'typeorm';
import { RepairExceptionAttendanceScope20260827275000 } from './migrations/20260827275000-RepairExceptionAttendanceScope';

describe('RepairExceptionAttendanceScope20260827275000', () => {
  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new RepairExceptionAttendanceScope20260827275000()[direction](runner);
    return statements.join('\n');
  };

  it('repairs applied draft schemas with reconciled school scope and real FKs', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS school_id INTEGER');
    expect(sql).toContain('SET school_id = session.school_id');
    expect(sql).toContain('roster.school_id <> session.school_id');
    expect(sql).toContain('exception school/roster reconciliation failed');
    expect(sql).toContain('UNIQUE (id, school_id)');
    expect(sql).toContain('FOREIGN KEY (session_id, school_id)');
    expect(sql).toContain('FOREIGN KEY (session_id, student_uuid)');
    expect(sql).toContain('FOREIGN KEY (marked_by_teacher_membership_id, school_id)');
    expect(sql).toContain('NOT VALID');
    expect(sql).toContain('VALIDATE CONSTRAINT fk_attendance_exceptions_roster');
    expect(sql).toContain('CHECK (school_id IS NOT NULL) NOT VALID');
    expect(sql).toContain('ALTER COLUMN school_id SET NOT NULL');
  });

  it('captures the pre-repair shape and restores only constraints introduced by the repair', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('exception_attendance_scope_repair_20260827_backup');
    expect(sql).toContain('IF NOT repair.roster_session_school_fk_existed');
    expect(sql).toContain('ADD CONSTRAINT fk_attendance_session_roster_session');
    expect(sql).toContain('ADD CONSTRAINT fk_attendance_exceptions_student');
    expect(sql).toContain('DROP COLUMN school_id');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS uq_attendance_sessions_id_school');
  });
});

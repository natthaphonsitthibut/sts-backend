import type { QueryRunner } from 'typeorm';
import { AddAttendanceAndStudentCareMasterData20260827280000 } from './migrations/20260827280000-AddAttendanceAndStudentCareMasterData';

describe('AddAttendanceAndStudentCareMasterData20260827280000', () => {
  async function collect(direction: 'up' | 'down'): Promise<string> {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddAttendanceAndStudentCareMasterData20260827280000()[direction](runner);
    return statements.join('\n');
  }

  it('adds secured catalogs, explicit mappings, consumer FKs and indexes', async () => {
    const sql = await collect('up');

    expect(sql).toContain('attendance_exceptions prerequisite is missing');
    expect(sql).toContain('CREATE TABLE master_data_reconcile_backup_20260824');
    expect(sql).toContain("('UNMATCHED', 'ยังไม่ได้จับคู่', 90, FALSE)");
    expect(sql).toContain('CREATE TABLE absence_reasons');
    expect(sql).toContain('fk_attendance_exceptions_absence_reason');
    expect(sql).toContain('idx_attendance_exceptions_reason_session');
    expect(sql).toContain('CREATE TABLE student_term_disadvantages');
    expect(sql).toContain('CREATE TABLE student_disabilities');
    expect(sql).toContain('idx_student_term_disadvantages_recorder');
    expect(sql).toContain('idx_student_disabilities_recorder');
    expect(sql).toContain("'student_term_disadvantage'");
    expect(sql).toContain("'student_disability'");
    expect(sql).toContain('unknown positive DisadvantageEducationID_Onec cannot be inferred');
    expect(sql).toContain('unknown positive DisabilityID_Onec cannot be inferred');
    expect(sql).toContain('ALTER TABLE absence_reason_categories ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE');
    expect(sql).toContain('default_permissions || \'["master-data"]\'::jsonb');
  });

  it('has a fail-closed, restorative rollback', async () => {
    const sql = await collect('down');

    expect(sql).toContain('refusing rollback: post-migration master-data usage would be lost');
    expect(sql).toContain("backup.entity_name = 'student_term_disadvantage'");
    expect(sql).toContain("backup.entity_name = 'student_disability'");
    expect(sql).toContain(
      "UPDATE roles target SET default_permissions = backup.original_row->'permissions'",
    );
    expect(sql).toContain('DROP CONSTRAINT fk_attendance_exceptions_absence_reason');
    expect(sql).toContain('UPDATE student_status target SET');
    expect(sql).toContain('DROP TABLE master_data_reconcile_backup_20260824');
  });
});

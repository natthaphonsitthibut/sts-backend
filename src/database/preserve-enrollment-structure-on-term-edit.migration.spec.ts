import type { QueryRunner } from 'typeorm';
import { CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL } from './customer-alignment-bootstrap-sql';
import { PreserveEnrollmentStructureOnTermEdit20261011100000 } from './migrations/20261011100000-PreserveEnrollmentStructureOnTermEdit';

describe('PreserveEnrollmentStructureOnTermEdit20261011100000', () => {
  async function collectSql(direction: 'up' | 'down'): Promise<string> {
    const query = jest.fn<Promise<unknown[]>, [string]>().mockResolvedValue([]);
    await new PreserveEnrollmentStructureOnTermEdit20261011100000()[direction]({
      query,
    } as unknown as QueryRunner);
    return String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
  }

  it('preserves only an unchanged historical scope whose master matches the new labels', async () => {
    const sql = await collectSql('up');
    for (const condition of [
      "TG_OP = 'UPDATE'",
      'NEW."SchoolID_Onec" IS NOT DISTINCT FROM OLD."SchoolID_Onec"',
      'NEW."GradeLevelID_Onec" IS NOT DISTINCT FROM OLD."GradeLevelID_Onec"',
      'NEW."RoomID_Onec" IS NOT DISTINCT FROM OLD."RoomID_Onec"',
      'NEW.school_term_id IS NOT DISTINCT FROM OLD.school_term_id',
      'NEW.classroom_id IS NOT DISTINCT FROM OLD.classroom_id',
      'classroom.id = OLD.classroom_id',
      'classroom.school_term_id = term.id',
      'classroom.school_id = term.school_id',
      'term.id = OLD.school_term_id',
      'term.academic_year = NEW."AcademicYear_Onec"',
      'term.semester = NEW."Semester_Onec"',
    ]) {
      expect(sql).toContain(condition);
      expect(CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL.replace(/\s+/g, ' ')).toContain(condition);
    }
    expect(sql).toContain("classroom.classroom_status = 'ACTIVE'");
    expect(sql).toContain('classroom.deleted_at IS NULL');
    expect(sql).not.toContain('ALTER TABLE');
  });

  it('reverts to the original fail-closed active-classroom resolver without data writes', async () => {
    const sql = await collectSql('down');
    expect(sql).not.toContain("TG_OP = 'UPDATE'");
    expect(sql).toContain("classroom.classroom_status = 'ACTIVE'");
    expect(sql).toContain('term.deleted_at IS NULL');
    expect(sql).toContain("ERRCODE = '23503'");
    expect(sql).not.toContain('UPDATE student_term');
    expect(sql).not.toContain('DROP');
  });
});

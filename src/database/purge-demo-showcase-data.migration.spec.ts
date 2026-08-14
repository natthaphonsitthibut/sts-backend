import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/database/migrations/20260812120000-PurgeDemoShowcaseData.ts'),
  'utf8',
);

describe('demo showcase purge migration', () => {
  it('purges every approved attendance marker without deleting mixed operational sessions', () => {
    expect(source).toContain("LIKE 'TEACHER_ACCESS_DEMO:%'");
    expect(source).toContain("'SYSTEM:THEPSIRIN_SHOWCASE'");
    expect(source).toContain("'SYSTEM:THEPSIRIN_RISK_SHOWCASE'");
    expect(source).toContain("'SYSTEM:DEMO_RISK_DISTRIBUTION'");
    expect(source).toContain('COALESCE(operational_record."RecordedBy", \'\') LIKE');
    expect(source).toContain('DELETE FROM student_risk_profiles');
  });

  it('deletes demo workflow rows in foreign-key order', () => {
    const submissionDelete = source.indexOf('DELETE FROM task_submissions');
    const linkDelete = source.indexOf('DELETE FROM task_links link');
    const taskDelete = source.indexOf('DELETE FROM tasks task');
    const caseDelete = source.indexOf('DELETE FROM cases WHERE');
    expect(submissionDelete).toBeGreaterThan(0);
    expect(linkDelete).toBeGreaterThan(submissionDelete);
    expect(taskDelete).toBeGreaterThan(linkDelete);
    expect(caseDelete).toBeGreaterThan(taskDelete);
  });

  it('removes exact demo calendar reasons and makes the index change reversible', () => {
    for (const reason of [
      'ข้อมูลสาธิตความเสี่ยงทุกโรงเรียน',
      'ข้อมูลสาธิตความเสี่ยงโรงเรียน showcase',
      'ข้อมูลสาธิตการเช็คชื่อย้อนหลัง',
    ]) {
      expect(source).toContain(reason);
    }
    expect(source).toContain('DROP INDEX IF EXISTS idx_attendance_demo_risk_distribution_student');
    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_attendance_demo_risk_distribution_student',
    );
  });
});

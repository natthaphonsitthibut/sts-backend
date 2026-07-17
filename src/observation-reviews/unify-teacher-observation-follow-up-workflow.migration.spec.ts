import type { QueryRunner } from 'typeorm';
import { UnifyTeacherObservationFollowUpWorkflow20260718110000 } from '../database/migrations/20260718110000-UnifyTeacherObservationFollowUpWorkflow';

describe('UnifyTeacherObservationFollowUpWorkflow20260718110000', () => {
  it('adds catalog-backed statuses, provenance FKs and a reversible non-destructive down path', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    const migration = new UnifyTeacherObservationFollowUpWorkflow20260718110000();

    await migration.up(runner);
    await migration.down(runner);

    const up = statements.slice(0, 5).join(' ');
    const down = statements.slice(5).join(' ');
    expect(up).toContain('CREATE TABLE student_follow_up_request_statuses');
    expect(up).toContain("('APPROVED', 'เปิดเคสแล้ว'");
    expect(up).toContain('FOREIGN KEY (opened_case_id) REFERENCES cases(id)');
    expect(up).toContain('FOREIGN KEY (source_task_link_id) REFERENCES task_links(id)');
    expect(up).toContain('FOREIGN KEY (source_timetable_slot_id) REFERENCES timetable_slots(id)');
    expect(up).toContain("WHERE request.status = 'APPROVED'");
    expect(down).not.toContain('DELETE FROM student_observations');
    expect(down).not.toContain('DELETE FROM cases');
    expect(down).toContain('DROP COLUMN IF EXISTS source_task_link_id');
  });
});

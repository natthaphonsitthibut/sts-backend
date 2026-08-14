import type { QueryRunner } from 'typeorm';
import { HardenTimetableSlotTeacherAudit20260810120000 } from './migrations/20260810120000-HardenTimetableSlotTeacherAudit';

describe('HardenTimetableSlotTeacherAudit20260810120000', () => {
  it('adds a reversible FK with explicit user lifecycle behavior', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const queryRunner = { query } as unknown as QueryRunner;
    const migration = new HardenTimetableSlotTeacherAudit20260810120000();

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const calls = query.mock.calls as unknown as Array<[string]>;
    const upSql = String(calls[0]?.[0]).replace(/\s+/g, ' ');
    const downSql = String(calls[1]?.[0]).replace(/\s+/g, ' ');
    expect(upSql).toContain('FOREIGN KEY (created_by) REFERENCES users(id)');
    expect(upSql).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
    expect(downSql).toContain('DROP CONSTRAINT IF EXISTS fk_timetable_slot_teachers_created_by');
  });
});

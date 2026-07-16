import type { QueryRunner } from 'typeorm';
import { RemoveExecutiveReportingAndWorkSessions20260716120000 } from './migrations/20260716120000-RemoveExecutiveReportingAndWorkSessions';

describe('RemoveExecutiveReportingAndWorkSessions migration', () => {
  function queryRunner(): { query: jest.Mock; runner: QueryRunner } {
    const query = jest.fn().mockResolvedValue(undefined);
    return { query, runner: { query } as unknown as QueryRunner };
  }

  it('drops invasive location tables in dependency order and retires permission/export state', async () => {
    const { query, runner } = queryRunner();

    await new RemoveExecutiveReportingAndWorkSessions20260716120000().up(runner);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql.indexOf('DROP TABLE IF EXISTS visit_position_pings')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS visit_work_sessions'),
    );
    expect(sql).toContain("dataset_code = 'executive_aggregate'");
    expect(sql).toContain("failure_code = 'DATASET_RETIRED'");
    expect(sql).toContain("- 'executive-report'");
    expect(sql).toContain('DROP TABLE IF EXISTS executive_aggregate_permission_backups');
  });

  it('recreates the schema with explicit checks, indexes, and cascade behavior', async () => {
    const { query, runner } = queryRunner();

    await new RemoveExecutiveReportingAndWorkSessions20260716120000().down(runner);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('task_link_id UUID NOT NULL');
    expect(sql).toContain("CHECK (end_reason IN ('MANUAL', 'SUBMITTED', 'TIMEOUT'))");
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
    expect(sql).toContain('uq_visit_work_sessions_open_per_link');
    expect(sql).toContain('idx_visit_position_pings_session_recorded');
    expect(sql).toContain("failure_code = 'DATASET_RESTORED_RETRY_REQUIRED'");
  });
});

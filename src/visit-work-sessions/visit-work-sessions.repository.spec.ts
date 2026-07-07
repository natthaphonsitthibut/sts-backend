import { VisitWorkSessionsRepository } from './visit-work-sessions.repository';

describe('VisitWorkSessionsRepository', () => {
  function buildRepository() {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new VisitWorkSessionsRepository(dataSource as never);
    return { repository, queries };
  }

  it('startSession inserts with the link id and a consent timestamp', async () => {
    const { repository, queries } = buildRepository();
    const consentAt = new Date('2026-07-07T00:00:00Z');

    await repository.startSession('link-1', consentAt);

    expect(queries[0].sql).toContain('INSERT INTO visit_work_sessions');
    expect(queries[0].params).toEqual(['link-1', consentAt]);
  });

  it('insertPingIfOpen only inserts when the session is still open', async () => {
    const { repository, queries } = buildRepository();

    await repository.insertPingIfOpen('1', 18.7, 98.9);

    expect(queries[0].sql).toContain('WHERE EXISTS');
    expect(queries[0].sql).toContain('ended_at IS NULL');
    expect(queries[0].params).toEqual(['1', 18.7, 98.9]);
  });

  it('listActiveForMonitor applies no extra scope filter for a global actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.listActiveForMonitor({ global: true });

    expect(queries[0].sql).toContain('vws.ended_at IS NULL');
    expect(queries[0].sql).not.toContain('1=0');
    expect(queries[0].sql).not.toContain('c.school_id = ANY');
  });

  it('listActiveForMonitor filters by school_id for a school-scoped actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.listActiveForMonitor({ school_ids: [10010002] });

    expect(queries[0].sql).toContain('c.school_id = ANY($1::int[])');
    expect(queries[0].params).toEqual([[10010002]]);
  });

  it('listActiveForMonitor fails closed (0 rows) for a non-global actor with no scope', async () => {
    const { repository, queries } = buildRepository();

    await repository.listActiveForMonitor({});

    expect(queries[0].sql).toContain('(1=0)');
  });

  it('listActiveForMonitor narrows further by the SchoolAreaSchoolFilter dimensions', async () => {
    const { repository, queries } = buildRepository();

    await repository.listActiveForMonitor(
      { global: true },
      { schoolId: 10010002, province: 'เชียงใหม่', grade: 'ป.6', room: '1' },
    );

    expect(queries[0].sql).toContain('c.school_id = $1');
    expect(queries[0].sql).toContain('sc.province = $2');
    expect(queries[0].sql).toContain('gl.label = $3');
    expect(queries[0].sql).toContain('st."RoomID_Onec"::text = $4');
    expect(queries[0].params).toEqual([10010002, 'เชียงใหม่', 'ป.6', '1']);
  });

  it('listRecentlyEnded narrows by the same filter dimensions', async () => {
    const { repository, queries } = buildRepository();

    await repository.listRecentlyEnded({ global: true }, 20, { schoolId: 10010002 });

    expect(queries[0].sql).toContain('c.school_id = $1');
    expect(queries[0].params).toEqual([10010002, 20]);
  });

  it('claimTimedOutSessions closes sessions whose latest activity is before the cutoff', async () => {
    const { repository, queries } = buildRepository();
    const cutoff = new Date('2026-07-07T09:30:00Z');

    await repository.claimTimedOutSessions(cutoff);

    expect(queries[0].sql).toContain("end_reason = 'TIMEOUT'");
    expect(queries[0].sql).toContain('last_activity_at < $1');
    expect(queries[0].params).toEqual([cutoff]);
  });

  it('deletePingsOlderThan deletes rows recorded before the cutoff', async () => {
    const { repository, queries } = buildRepository();
    const cutoff = new Date('2026-07-01T00:00:00Z');

    await repository.deletePingsOlderThan(cutoff);

    expect(queries[0].sql).toContain('DELETE FROM visit_position_pings');
    expect(queries[0].sql).toContain('recorded_at < $1');
    expect(queries[0].params).toEqual([cutoff]);
  });
});

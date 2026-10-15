import { AttendanceTrendCache } from './attendance-trend-cache.service';
import type { HomeDashboardTrendPoint } from './home-dashboard.types';

describe('AttendanceTrendCache', () => {
  afterEach(() => jest.useRealTimers());

  it('coalesces concurrent reads and expires completed results after 15 seconds', async () => {
    jest.useFakeTimers();
    const cache = new AttendanceTrendCache();
    const load = jest.fn().mockResolvedValue([]);
    await Promise.all([cache.read('school:1', load), cache.read('school:1', load)]);
    await cache.read('school:1', load);
    expect(load).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(15_001);
    await cache.read('school:1', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not share distinct scope/date keys or retain failed reads', async () => {
    const cache = new AttendanceTrendCache();
    const failure = new Error('query failed');
    const load = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue([]);
    const outcomes = await Promise.allSettled([
      cache.read('school:1', load),
      cache.read('school:1', load),
    ]);
    expect(outcomes.every((result) => result.status === 'rejected')).toBe(true);
    await cache.read('school:1', load);
    await cache.read('school:2', load);
    await cache.read('school:1:other-date', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('invalidates after a write and does not restore an older in-flight read', async () => {
    const cache = new AttendanceTrendCache();
    let finish!: (points: HomeDashboardTrendPoint[]) => void;
    const pending = cache.read(
      'scope',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    cache.invalidate();
    const fresh = jest.fn().mockResolvedValue([]);
    await cache.read('scope', fresh);
    finish([]);
    await pending;
    await cache.read('scope', fresh);
    expect(fresh).toHaveBeenCalledTimes(1);
    cache.invalidate();
    await cache.read('scope', fresh);
    expect(fresh).toHaveBeenCalledTimes(2);
  });

  it('bounds distinct entries to 100', async () => {
    const cache = new AttendanceTrendCache();
    const load = jest.fn().mockResolvedValue([]);
    for (let index = 0; index < 101; index++) await cache.read(String(index), load);
    await cache.read('100', load);
    expect(load).toHaveBeenCalledTimes(101);
    await cache.read('0', load);
    expect(load).toHaveBeenCalledTimes(102);
  });
});

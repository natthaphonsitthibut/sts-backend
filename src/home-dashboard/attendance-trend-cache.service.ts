import { Injectable } from '@nestjs/common';
import type { HomeDashboardTrendPoint } from './home-dashboard.types';

interface TrendCacheEntry {
  expiresAt: number;
  value: Promise<HomeDashboardTrendPoint[]>;
}

/** Per-process, bounded cache. Other replicas expire within 15 seconds. */
@Injectable()
export class AttendanceTrendCache {
  private readonly entries = new Map<string, TrendCacheEntry>();

  read(
    key: string,
    load: () => Promise<HomeDashboardTrendPoint[]>,
  ): Promise<HomeDashboardTrendPoint[]> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.value;
    this.entries.delete(key);
    if (this.entries.size >= 100) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    const entry: TrendCacheEntry = { expiresAt: Infinity, value: Promise.resolve([]) };
    entry.value = Promise.resolve()
      .then(load)
      .then(
        (points) => {
          entry.expiresAt = Date.now() + 15_000;
          return points;
        },
        (error: unknown) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Call only after commit; an older in-flight read cannot restore its entry. */
  invalidate(): void {
    this.entries.clear();
  }
}

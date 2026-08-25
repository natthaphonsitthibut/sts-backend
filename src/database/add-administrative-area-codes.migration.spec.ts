import type { QueryRunner } from 'typeorm';
import {
  ADMINISTRATIVE_DISTRICTS,
  ADMINISTRATIVE_PROVINCES,
  ADMINISTRATIVE_SUB_DISTRICTS,
} from './administrative-area-catalog';
import { AddAdministrativeAreaCodes20260827311000 } from './migrations/20260827311000-AddAdministrativeAreaCodes';

describe('AddAdministrativeAreaCodes20260827311000', () => {
  it('contains the complete current DOPA hierarchy', () => {
    expect(ADMINISTRATIVE_PROVINCES).toHaveLength(77);
    expect(ADMINISTRATIVE_DISTRICTS).toHaveLength(928);
    expect(ADMINISTRATIVE_SUB_DISTRICTS).toHaveLength(7436);

    const provinceCodes = new Set(ADMINISTRATIVE_PROVINCES.map(([code]) => code));
    const districtParents = new Map(
      ADMINISTRATIVE_DISTRICTS.map(([code, provinceCode]) => [code, provinceCode]),
    );
    for (const [code, provinceCode] of ADMINISTRATIVE_DISTRICTS) {
      expect(code.startsWith(provinceCode)).toBe(true);
      expect(provinceCodes.has(provinceCode)).toBe(true);
    }
    for (const [code, districtCode, provinceCode] of ADMINISTRATIVE_SUB_DISTRICTS) {
      expect(code.startsWith(districtCode)).toBe(true);
      expect(districtParents.get(districtCode)).toBe(provinceCode);
    }
  });

  it('creates constrained hierarchy, deterministic backfill, and reversible teardown', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const runner = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    const migration = new AddAdministrativeAreaCodes20260827311000();

    await migration.up(runner);
    const upSql = calls.map(({ sql }) => sql).join('\n');
    expect(upSql).toContain('CREATE TABLE administrative_provinces');
    expect(upSql).toContain('CREATE TABLE administrative_districts');
    expect(upSql).toContain('CREATE TABLE administrative_sub_districts');
    expect(upSql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(upSql).toContain('chk_schools_administrative_area_hierarchy');
    expect(upSql).toContain('idx_schools_administrative_area_codes');
    expect(upSql).toContain("REGEXP_REPLACE(BTRIM(school.district), '^(อำเภอ|เขต)', '')");
    const seedPayloads = calls.flatMap(({ params }) => params ?? []).map(String);
    expect(seedPayloads.some((payload) => payload.includes('"code":"10"'))).toBe(true);
    expect(seedPayloads.some((payload) => payload.includes('"province_code":"10"'))).toBe(true);
    expect(seedPayloads.some((payload) => payload.includes('"district_code":"1001"'))).toBe(true);

    calls.length = 0;
    await migration.down(runner);
    const downSql = calls.map(({ sql }) => sql).join('\n');
    expect(downSql).toContain('DROP COLUMN IF EXISTS sub_district_code');
    expect(downSql).toContain('DROP TABLE administrative_sub_districts');
    expect(downSql).toContain('DROP TABLE administrative_provinces');
  });
});

import { buildDataScopeQuery } from './authorization';
import { finalizePersistedDataScope, isUnconfiguredDataScope } from '../../auth/auth.types';

describe('buildDataScopeQuery', () => {
  it('returns no filter for an explicit global scope (nationwide actor)', () => {
    const result = buildDataScopeQuery({ global: true });

    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
  });

  it('builds area clauses for a scoped actor', () => {
    const result = buildDataScopeQuery({ school_ids: [10010001], provinces: ['เชียงใหม่'] });

    expect(result.sql).toContain('school_id = ANY($1::int[])');
    expect(result.sql).toContain('province = ANY($2::text[])');
    expect(result.params).toEqual([[10010001], ['เชียงใหม่']]);
  });

  it('fails closed (1=0) for an empty scope with no explicit global', () => {
    const result = buildDataScopeQuery({});

    expect(result.sql).toBe('1=0');
    expect(result.params).toEqual([]);
  });

  it('keeps the legacy pass-through for own_only scopes (service-layer gated)', () => {
    const result = buildDataScopeQuery({ own_only: true });

    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
  });

  it('ignores empty area arrays and still fails closed', () => {
    const result = buildDataScopeQuery({ provinces: [], school_ids: [] });

    expect(result.sql).toBe('1=0');
  });

  it('does not let a stray global flag disable area filtering', () => {
    const result = buildDataScopeQuery({ global: true, school_ids: [1] });

    expect(result.sql).toContain('school_id = ANY($1::int[])');
  });
});

describe('isUnconfiguredDataScope', () => {
  it('flags empty / null / area-less scopes', () => {
    expect(isUnconfiguredDataScope(undefined)).toBe(true);
    expect(isUnconfiguredDataScope(null)).toBe(true);
    expect(isUnconfiguredDataScope({})).toBe(true);
    expect(isUnconfiguredDataScope({ provinces: [], global: false })).toBe(true);
  });

  it('accepts explicit global, own_only, and area scopes', () => {
    expect(isUnconfiguredDataScope({ global: true })).toBe(false);
    expect(isUnconfiguredDataScope({ own_only: true })).toBe(false);
    expect(isUnconfiguredDataScope({ school_ids: [1] })).toBe(false);
  });
});

describe('finalizePersistedDataScope', () => {
  it('persists a confirmed-nationwide (empty) scope as explicit global', () => {
    expect(finalizePersistedDataScope({})).toEqual({ global: true });
    expect(finalizePersistedDataScope(undefined)).toEqual({ global: true });
    expect(finalizePersistedDataScope({ provinces: [] })).toEqual({ global: true });
  });

  it('keeps area scopes and strips a stray global flag', () => {
    expect(finalizePersistedDataScope({ global: true, school_ids: [1] })).toEqual({
      school_ids: [1],
    });
    expect(finalizePersistedDataScope({ provinces: ['เชียงใหม่'] })).toEqual({
      provinces: ['เชียงใหม่'],
    });
  });

  it('canonicalizes own_only scopes to self-only', () => {
    expect(finalizePersistedDataScope({ own_only: true })).toEqual({ own_only: true });
    expect(finalizePersistedDataScope({ own_only: true, school_ids: [1], global: true })).toEqual({
      own_only: true,
    });
  });
});

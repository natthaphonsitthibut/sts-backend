import type { QueryRunner } from 'typeorm';
import { RewritePresentationData20260827300000 } from './migrations/20260827300000-RewritePresentationData';

type BaselineOverrides = Partial<Record<string, number>>;

function baseline(overrides: BaselineOverrides = {}) {
  return {
    teachers_total: 446,
    teachers_active: 446,
    teachers_inactive: 0,
    memberships_total: 446,
    memberships_active: 446,
    memberships_inactive: 0,
    inactive_pair_count: 0,
    active_membership_duplicate_groups: 0,
    active_teachers_without_active_membership: 0,
    active_memberships_for_inactive_teachers: 0,
    sessions_total: 13231,
    attendance_rows_total: 179384,
    exception_rows_total: 35479,
    risk_profiles_total: 5980,
    cases_total: 12,
    calendar_forbidden_rows: 0,
    placeholder_student_rows: 1,
    placeholder_student_count: 1,
    target_student_name_rows: 0,
    presentation_origin_rows: 1,
    ...overrides,
  };
}

function verification(source: ReturnType<typeof baseline>) {
  return {
    teachers_total: 451,
    teachers_active: 451,
    memberships_total: 451,
    memberships_active: 451,
    active_membership_duplicate_groups: 0,
    invalid_membership_teacher_rows: 0,
    active_automated_users: 0,
    placeholder_student_rows: 0,
    target_student_name_rows: 1,
    presentation_origin_rows: 1,
    sessions_total: source.sessions_total,
    attendance_rows_total: source.attendance_rows_total,
    exception_rows_total: source.exception_rows_total,
    risk_profiles_total: source.risk_profiles_total,
    cases_total: source.cases_total,
    old_email_domain_rows: 0,
    forbidden_business_surface_rows: 0,
  };
}

function createRunner(source: ReturnType<typeof baseline>) {
  let insertedTeacherId = 1000;
  const query = jest.fn((sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.includes('AS teachers_inactive') && normalized.includes('AS sessions_total')) {
      return Promise.resolve([source]);
    }
    if (normalized.startsWith('SELECT teacher.id::text AS teacher_id')) {
      return Promise.resolve(
        source.teachers_inactive === 1 ? [{ teacher_id: '451', membership_id: '451' }] : [],
      );
    }
    if (normalized.startsWith('SELECT LOWER(email) AS email')) return Promise.resolve([]);
    if (normalized.startsWith('SELECT school.id AS school_id')) {
      return Promise.resolve(
        Array.from({ length: 451 - source.teachers_total }, (_, index) => ({
          school_id: 10010001 + index,
          started_on: '2026-05-01',
        })),
      );
    }
    if (normalized.startsWith('INSERT INTO teachers')) {
      insertedTeacherId += 1;
      return Promise.resolve([{ id: String(insertedTeacherId) }]);
    }
    if (normalized.includes('AS old_email_domain_rows')) {
      return Promise.resolve([verification(source)]);
    }
    return Promise.resolve([]);
  });

  return { query, runner: { query } as unknown as QueryRunner };
}

describe('RewritePresentationData20260827300000', () => {
  it('fills only the bounded local shortfall and rewrites every current email consumer', async () => {
    const source = baseline();
    const { query, runner } = createRunner(source);

    await new RewritePresentationData20260827300000().up(runner);

    const statements = query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
    expect(statements.filter((sql) => sql.startsWith('INSERT INTO teachers'))).toHaveLength(5);
    expect(
      statements.filter((sql) => sql.startsWith('INSERT INTO school_teacher_memberships')),
    ).toHaveLength(5);
    for (const target of [
      'UPDATE users',
      'UPDATE teachers',
      'UPDATE task_links',
      'UPDATE teacher_external_identities',
      'UPDATE araid_identity_records',
      'UPDATE student_guardian',
      'UPDATE student_person_contact',
    ]) {
      expect(statements).toContainEqual(expect.stringContaining(target));
    }
    expect(statements).toContainEqual(expect.stringContaining('UPDATE student_term'));
    expect(statements).toContainEqual(expect.stringContaining('UPDATE data_record_origins'));
  });

  it('reactivates the one production pair without seeding replacement teachers', async () => {
    const source = baseline({
      teachers_total: 451,
      teachers_active: 450,
      teachers_inactive: 1,
      memberships_total: 451,
      memberships_active: 450,
      memberships_inactive: 1,
      inactive_pair_count: 1,
      cases_total: 149,
      sessions_total: 13232,
      attendance_rows_total: 179396,
      exception_rows_total: 36200,
    });
    const { query, runner } = createRunner(source);

    await new RewritePresentationData20260827300000().up(runner);

    const statements = query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
    expect(statements).toContainEqual(expect.stringContaining("SET teacher_status = 'ACTIVE'"));
    expect(statements).toContainEqual(
      expect.stringContaining("SET membership_status = 'ACTIVE', ended_on = NULL"),
    );
    expect(statements).not.toContainEqual(expect.stringContaining('INSERT INTO teachers'));
  });

  it('fails closed when a baseline is outside the production/local manifest', async () => {
    const { runner } = createRunner(
      baseline({
        teachers_total: 445,
        teachers_active: 445,
        memberships_total: 445,
        memberships_active: 445,
      }),
    );

    await expect(new RewritePresentationData20260827300000().up(runner)).rejects.toThrow(
      'outside the production/local manifest',
    );
  });

  it('refuses rollback instead of restoring obsolete presentation markers', async () => {
    await expect(new RewritePresentationData20260827300000().down()).rejects.toThrow(
      'forward-only',
    );
  });
});

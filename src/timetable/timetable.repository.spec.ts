import { TimetableRepository } from './timetable.repository';

describe('TimetableRepository', () => {
  function buildRepository(rows: unknown[] = [{ ok: true }]) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: rows, affected: rows.length };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TimetableRepository(dataSource as never);
    return { repository, queries };
  }

  describe('isSchoolInScope', () => {
    it('checks only existence for a global actor', async () => {
      const { repository, queries } = buildRepository();
      await repository.isSchoolInScope(1, { global: true });
      expect(queries[0].sql).not.toContain('sc.province');
    });

    it('matches on school_ids for a school-scoped actor', async () => {
      const { repository, queries } = buildRepository();
      await repository.isSchoolInScope(1, { school_ids: [1, 2] });
      expect(queries[0].sql).toContain('sc.id = ANY($2::int[])');
      expect(queries[0].params).toEqual([1, [1, 2]]);
    });

    it('fails closed for a non-global actor with no area/school scope', async () => {
      const { repository, queries } = buildRepository();
      const allowed = await repository.isSchoolInScope(1, {});
      expect(allowed).toBe(false);
      expect(queries).toHaveLength(0);
    });
  });

  it('listForRoom filters by school/grade/room and excludes soft-deleted rows', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.listForRoom(1, 2, 3);
    expect(queries[0].sql).toContain(
      'ts.school_id = $1 AND ts.grade_level_id = $2 AND ts.room_no = $3',
    );
    expect(queries[0].sql).toContain('ts.deleted_at IS NULL');
    expect(queries[0].params).toEqual([1, 2, 3]);
  });

  it('listForRoom reads only the active term, so last term never leaks into check-in', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.listForRoom(1, 2, 3);
    expect(queries[0].sql).toMatch(
      /ts\.school_term_id = \([\s\S]*FROM school_terms term[\s\S]*term\.school_id = \$1[\s\S]*term\.status = 'ACTIVE'[\s\S]*LIMIT 1\s*\)/,
    );
  });

  it('listForTeacher filters by teacher_user_id and teacher_membership_id', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.listForTeacher(42, 100);
    expect(queries[0].sql).toContain('ts.teacher_membership_id = $1');
    expect(queries[0].params).toEqual([100, 42]);
  });

  it('gates the legacy ts.teacher_user_id fallback behind a NOT EXISTS guard', async () => {
    // Regression test: this fallback used to match unconditionally, so a slot
    // reassigned to a new teacher via timetable_slot_teachers still surfaced
    // on the *previous* teacher's schedule (via their stale legacy column) at
    // the same day/period as their real slot — a phantom double-booking.
    const { repository, queries } = buildRepository([]);
    await repository.listForTeacher(42, 100);
    const sql = queries[0].sql;
    const userIdBranchStart = sql.indexOf('$2::integer IS NOT NULL');
    const userIdBranch = sql.slice(userIdBranchStart);
    const notExistsIndex = userIdBranch.indexOf('NOT EXISTS');
    const legacyCheckIndex = userIdBranch.indexOf('ts.teacher_user_id = $2::integer');
    expect(notExistsIndex).toBeGreaterThan(-1);
    expect(legacyCheckIndex).toBeGreaterThan(-1);
    expect(notExistsIndex).toBeLessThan(legacyCheckIndex);
  });

  it('findById groups the teacher aggregates before returning a slot', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.findById('25716');
    expect(queries[0].sql).toContain('GROUP BY ts.id');
    expect(queries[0].params).toEqual(['25716']);
  });

  it('omits inactive teachers from timetable slot aggregates', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.listForRoom(1, 2, 3);
    expect(queries[0].sql).toContain("stm.membership_status = 'ACTIVE'");
    expect(queries[0].sql).toContain("t.teacher_status = 'ACTIVE'");
  });

  it('checks selected teachers are active and assigned to the room subject', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.listEligibleTeacherMembershipIds({
      schoolId: 1,
      gradeLevelId: 2,
      roomNo: 3,
      subjectId: 4,
      teacherMembershipIds: [5],
    });
    expect(queries[0].sql).toContain('assignment.subject_id = $4');
    expect(queries[0].sql).toContain('classroom.legacy_room_number = $3');
    expect(queries[0].sql).toContain("membership.membership_status = 'ACTIVE'");
    expect(queries[0].params).toEqual([1, 2, 3, 4, [5]]);
  });

  it('listTeacherCandidatesForSchool returns only active teacher memberships', async () => {
    const { repository, queries } = buildRepository([]);
    await repository.listTeacherCandidatesForSchool(10010002, 'สมชาย');
    expect(queries[0].sql).toContain(`t.deleted_at IS NULL`);
    expect(queries[0].sql).toContain(`membership.membership_status = 'ACTIVE'`);
    expect(queries[0].sql).toContain(`membership.school_id = $1`);
    expect(queries[0].sql).toContain('LIMIT 100');
    expect(queries[0].params).toEqual([10010002, '%สมชาย%']);
  });

  it('isActiveTeacherForSchool checks role, account, membership, and school together', async () => {
    const { repository, queries } = buildRepository();
    await expect(repository.isActiveTeacherForSchool(41, 10010002)).resolves.toBe(true);
    expect(queries[0].sql).toContain(`teacher.role = 'TEACHER'`);
    expect(queries[0].sql).toContain(`membership.school_id = $2`);
    expect(queries[0].params).toEqual([41, 10010002]);
  });
});

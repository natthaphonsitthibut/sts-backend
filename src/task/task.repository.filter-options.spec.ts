import { TaskRepository } from './task.repository';
import type { ActorContext, DataScope, RiskDashboardFilterOptions } from './task.types';

describe('TaskRepository report filter choices', () => {
  const actor = (data_scope?: DataScope): ActorContext => ({
    id: 7,
    username: 'report-reader',
    roles: ['EXECUTIVE'],
    permissions: ['dashboard'],
    data_scope,
  });
  const createRepository = (options?: RiskDashboardFilterOptions) => {
    const query = jest.fn().mockResolvedValue({
      records: options ? [options] : [],
      affected: options ? 1 : 0,
    });
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query,
    };
    return {
      repository: new TaskRepository(
        { createQueryRunner: jest.fn(() => runner) } as never,
        undefined as never,
        undefined as never,
      ),
      query,
    };
  };

  it.each([undefined, {}, { own_only: true }, { own_only: true, school_ids: [101] }])(
    'returns no options and makes no query for denied scope %j',
    async (scope) => {
      const { repository, query } = createRepository();
      await expect(
        repository.getRiskDashboardFilterOptions(actor(scope), { schoolId: 101 }),
      ).resolves.toEqual({ grades: [], rooms: [], terms: [] });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ global: true }, '', []],
    [{ provinces: ['ขอนแก่น'] }, 'sc.province = ANY($1::text[])', [['ขอนแก่น']]],
    [{ districts: ['เมืองขอนแก่น'] }, 'sc.district = ANY($1::text[])', [['เมืองขอนแก่น']]],
    [{ sub_districts: ['ในเมือง'] }, 'sc.sub_district = ANY($1::text[])', [['ในเมือง']]],
    [{ school_ids: [101] }, 's."SchoolID_Onec" = ANY($1::int[])', [[101]]],
  ] as Array<[DataScope, string, unknown[]]>)(
    'supports geographic scope %j without requiring a school pick',
    async (scope, expectedCondition, expectedParams) => {
      const options = {
        grades: [{ value: 'ม.1', label: 'ม.1' }],
        rooms: ['1', '2'],
        terms: [{ academicYear: 2569, semester: 1 }],
      };
      const { repository, query } = createRepository(options);
      await expect(repository.getRiskDashboardFilterOptions(actor(scope))).resolves.toEqual(
        options,
      );
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain(expectedCondition);
      expect(params).toEqual(expectedParams);
      expect(sql).not.toContain('school_terms');
    },
  );

  it('intersects requested school and area with actor school, grade and room scope', async () => {
    const { repository, query } = createRepository();
    await repository.getRiskDashboardFilterOptions(
      actor({ school_ids: [101], grade_levels: [6], room_ids: ['2'] }),
      { schoolId: 999, province: 'ขอนแก่น', district: 'เมืองขอนแก่น', subDistrict: 'ในเมือง' },
    );
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('s."SchoolID_Onec" = ANY($1::int[])');
    expect(sql).toContain('s."GradeLevelID_Onec" = ANY($2::int[])');
    expect(sql).toContain('s."RoomID_Onec"::text = ANY($3::text[])');
    expect(sql).toContain('AND sc.province = $4 AND sc.district = $5');
    expect(sql).toContain('AND sc.sub_district = $6 AND s."SchoolID_Onec" = $7');
    expect(params).toEqual([[101], [6], ['2'], 'ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง', 999]);
  });

  it('keeps all real terms available while year, semester and grade narrow dependent choices', async () => {
    const { repository, query } = createRepository();
    await repository.getRiskDashboardFilterOptions(actor({ global: true }), {
      academicYear: 2569,
      semester: 3,
      grade: 'ม.1',
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([2569, 3, 'ม.1']);
    expect(sql).toContain('WHERE academic_year = $1 AND semester = $2');
    expect(sql).toContain('SELECT grade_label, MIN(grade_id) AS grade_id');
    expect(sql).toContain("WHERE room IS NOT NULL AND TRIM(room) <> '' AND grade_label = $3");
    expect(sql).toContain('SELECT DISTINCT academic_year, semester FROM scoped_enrollments');
    const termQuery = sql.slice(sql.indexOf('SELECT DISTINCT academic_year, semester'));
    expect(termQuery).not.toContain('= $');
    expect(sql.match(/grade_label = \$3/g)).toHaveLength(1);
  });

  it('offers retained historical enrollment terms and excludes deleted enrollments', async () => {
    const { repository, query } = createRepository({
      grades: [],
      rooms: [],
      terms: [
        { academicYear: 2568, semester: 2 },
        { academicYear: 2569, semester: 1 },
      ],
    });
    const result = await repository.getRiskDashboardFilterOptions(actor({ global: true }));
    expect(result.terms).toContainEqual({ academicYear: 2568, semester: 2 });
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('WHERE s.deleted_at IS NULL');
    expect(sql).not.toContain('current_enrollment.selected_student_uuid');
    expect(sql).not.toContain('student_name');
  });
});

describe('TaskRepository referral term filters', () => {
  const actor: ActorContext = {
    id: 7,
    username: 'school-reader',
    roles: ['EXECUTIVE'],
    permissions: ['dashboard'],
    data_scope: { school_ids: [101] },
  };
  it.each([true, false])(
    'applies the same scope and optional enrollment term to summary, rows and counts (selected=%s)',
    async (selected) => {
      const queries: Array<{ sql: string; params: unknown[] }> = [];
      const runner = {
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn((sql: string, params: unknown[]) => {
          queries.push({ sql, params });
          return { records: [], affected: 0 };
        }),
      };
      const repository = new TaskRepository(
        { createQueryRunner: jest.fn(() => runner) } as never,
        undefined as never,
        undefined as never,
      );
      const filters = selected ? { academicYear: 2569, semester: 1, grade: 'ม.1', room: '2' } : {};
      await repository.getFollowUpOutcomeAggregate(actor, filters);
      await repository.getAssistanceMeasureAggregate(actor, filters);
      await repository.getReferralAggregate(actor, filters);
      await repository.countRepeatedUnsuccessfulCases(actor, filters);
      await repository.listReferralDrilldown(actor, filters, 1, 20);
      expect(queries).toHaveLength(6);
      for (const { sql, params } of queries) {
        expect(sql).toContain('c.school_id = ANY($1::int[])');
        if (selected) {
          expect(params.slice(0, 5)).toEqual([[101], 'ม.1', '2', 2569, 1]);
          expect(sql).toContain('class_student.student_uuid = c.student_uuid');
          expect(sql).toContain('class_grade.label = $2');
          expect(sql).toContain('class_student."RoomID_Onec"::text = $3');
          expect(sql).toContain('class_student."AcademicYear_Onec" = $4');
          expect(sql).toContain('class_student."Semester_Onec" = $5');
        } else {
          expect(params[0]).toEqual([101]);
          expect(sql).not.toContain('class_student."AcademicYear_Onec"');
          expect(sql).not.toContain('class_student."Semester_Onec"');
        }
      }
    },
  );
});

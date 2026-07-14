import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { ExecutiveReportingService } from './executive-reporting.service';
import type { ExecutiveReportingAggregateRow } from './executive-reporting.types';

const ACTOR: AuthenticatedRequestUser = {
  id: 10,
  username: 'executive',
  roles: ['EXECUTIVE'],
  permissions: ['executive-report'],
  data_scope: { provinces: ['เชียงใหม่'] },
};

const GOLDEN_ROW: ExecutiveReportingAggregateRow = {
  province: 'เชียงใหม่',
  district: null,
  school_id: null,
  school_name: null,
  active_student_count: '120',
  risk_high_count: '4',
  risk_medium_count: '15',
  risk_low_count: '20',
  risk_watch_count: '12',
  risk_normal_count: '64',
  risk_missing_profile_count: '5',
  human_concern_student_count: '3',
  case_created_count: '9',
  unresolved_case_count: '11',
  resolved_case_count: '6',
  reported_up_case_count: '7',
  enrollment_academic_year: '2569',
  enrollment_semester: '1',
  risk_profile_calculated_at: '2026-07-15T01:00:00.000Z',
  human_observation_at: '2026-07-15T02:00:00.000Z',
  case_updated_at: '2026-07-15T03:00:00.000Z',
};

describe('ExecutiveReportingService', () => {
  function buildService(rows: ExecutiveReportingAggregateRow[] = [GOLDEN_ROW]) {
    const repository = {
      isFilterWithinScope: jest.fn().mockResolvedValue(true),
      getOverview: jest.fn().mockResolvedValue(rows),
    };
    return {
      service: new ExecutiveReportingService(repository as never, { minimumCellSize: 5 }),
      repository,
    };
  }

  it('maps golden totals, risk, reported-up and freshness without PII', async () => {
    const { service } = buildService();

    const result = await service.getOverview(ACTOR, {
      province: 'เชียงใหม่',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-15T23:59:59.000Z',
    });

    expect(result.areas[0]).toMatchObject({
      level: 'PROVINCE',
      activeStudents: { value: 120, suppressed: false },
      risk: {
        high: { value: null, suppressed: true },
        medium: { value: 15, suppressed: false },
        missingProfile: { value: 5, suppressed: false },
        humanConcernStudentsInPeriod: { value: null, suppressed: true },
      },
      cases: {
        reportedUp: { value: 7, suppressed: false },
        resolvedInPeriod: { value: 6, suppressed: false },
      },
      freshness: {
        enrollmentAcademicYear: 2569,
        enrollmentSemester: 1,
        riskProfileCalculatedAt: '2026-07-15T01:00:00.000Z',
        humanObservationAt: '2026-07-15T02:00:00.000Z',
        caseUpdatedAt: '2026-07-15T03:00:00.000Z',
      },
    });
    expect(result.summary).toMatchObject({
      activeStudents: { value: 120, suppressed: false },
      risk: { high: { value: null, suppressed: true } },
      cases: { reportedUp: { value: 7, suppressed: false } },
      freshness: { riskProfileCalculatedAt: '2026-07-15T01:00:00.000Z' },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('studentUuid');
    expect(serialized).not.toContain('studentName');
    expect(serialized).not.toContain('comment');
  });

  it('rolls area rows into a golden summary before suppression', async () => {
    const second: ExecutiveReportingAggregateRow = {
      ...GOLDEN_ROW,
      province: 'ลำพูน',
      active_student_count: 30,
      risk_high_count: 6,
      reported_up_case_count: 2,
      risk_profile_calculated_at: '2026-07-16T01:00:00.000Z',
    };
    const { service } = buildService([GOLDEN_ROW, second]);

    const result = await service.getOverview(
      { ...ACTOR, data_scope: { global: true } },
      { groupBy: 'PROVINCE' },
    );

    expect(result.summary.activeStudents).toEqual({ value: 150, suppressed: false });
    expect(result.summary.risk.high).toEqual({ value: 10, suppressed: false });
    expect(result.summary.cases.reportedUp).toEqual({ value: 9, suppressed: false });
    expect(result.summary.freshness.riskProfileCalculatedAt).toBe('2026-07-16T01:00:00.000Z');
  });

  it('fails closed for self-only, empty, or classroom-limited actors', async () => {
    const { service } = buildService();
    await expect(
      service.getOverview({ ...ACTOR, data_scope: { own_only: true } }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getOverview({ ...ACTOR, data_scope: {} }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.getOverview(
        { ...ACTOR, data_scope: { school_ids: [1], room_ids: [2] } },
        { schoolId: 1 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects direct filter probing outside actor scope', async () => {
    const { service, repository } = buildService();
    repository.isFilterWithinScope.mockResolvedValue(false);
    await expect(service.getOverview(ACTOR, { province: 'กรุงเทพมหานคร' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.getOverview).not.toHaveBeenCalled();
  });

  it('rejects ambiguous or inverted filter contracts', async () => {
    const { service } = buildService();
    await expect(service.getOverview(ACTOR, { district: 'เมือง' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.getOverview(ACTOR, {
        from: '2026-07-16T00:00:00.000Z',
        to: '2026-07-15T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

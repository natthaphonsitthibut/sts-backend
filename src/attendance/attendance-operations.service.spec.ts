import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { AttendanceOperationsService } from './attendance-operations.service';
import type { QueryExecutor } from './attendance.types';

describe('AttendanceOperationsService', () => {
  it('denies a school outside the authenticated scope', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(false),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    await expect(
      service.listTerms(10010002, {
        id: 5,
        username: 'school-admin',
        roles: ['ADMIN_SCHOOL'],
        permissions: ['attendance-dashboard'],
        data_scope: { school_ids: [20020003] },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not activate a term until every calendar date exists', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: jest.fn(
        async (callback: (executor: QueryExecutor) => Promise<unknown>): Promise<unknown> =>
          await callback({ query: jest.fn() }),
      ),
      upsertTerm: jest.fn().mockResolvedValue({
        id: '10',
        school_id: 10010002,
        school_name: 'โรงเรียนทดสอบ',
        academic_year: 2569,
        semester: 1,
        starts_on: '2026-05-01',
        ends_on: '2026-05-31',
        status: 'ACTIVE',
        calendar_day_count: 10,
        school_day_count: 8,
      }),
      getCalendarCoverage: jest.fn().mockResolvedValue({
        calendarDayCount: 10,
        schoolDayCount: 8,
      }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    await expect(
      service.upsertTerm(
        {
          schoolId: 10010002,
          academicYear: 2569,
          semester: 1,
          startsOn: '2026-05-01',
          endsOn: '2026-05-31',
          status: 'ACTIVE',
        },
        {
          id: 5,
          username: 'director',
          roles: ['DIRECTOR'],
          permissions: ['manage-attendance-calendar'],
          data_scope: { school_ids: [10010002] },
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not reconcile attendance for a draft term', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      findTermById: jest.fn().mockResolvedValue({
        id: '10',
        school_id: 10010002,
        academic_year: 2569,
        semester: 1,
        starts_on: '2026-05-01',
        ends_on: '2026-05-31',
        status: 'DRAFT',
      }),
      findCalendarDay: jest.fn(),
      listReconciliation: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    await expect(
      service.getReconciliation(10, '2026-05-15', 1, 20, {
        id: 5,
        username: 'school-admin',
        roles: ['ADMIN'],
        permissions: ['attendance-dashboard'],
        data_scope: { school_ids: [10010002] },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.findCalendarDay).not.toHaveBeenCalled();
    expect(repository.listReconciliation).not.toHaveBeenCalled();
  });

  it('returns scoped attendance session anomalies for an active term', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      findTermById: jest.fn().mockResolvedValue({
        id: '10',
        school_id: 10010002,
        academic_year: 2569,
        semester: 1,
        starts_on: '2026-05-01',
        ends_on: '2026-05-31',
        status: 'ACTIVE',
      }),
      listSessionAnomalies: jest.fn().mockResolvedValue({
        rows: [
          {
            session_id: '4bf84262-c297-47f6-9c03-084416ac7652',
            attendance_date: '2026-05-10',
            grade_level_id: 3,
            grade_label: 'ป.3',
            room_id: 1,
            expected_roster_count: 42,
            recorded_count: 42,
            session_status: 'SUBMITTED',
            revision: 1,
            day_type: 'HOLIDAY',
            calendar_reason: 'วันหยุดตัวอย่าง',
            anomaly_type: 'HOLIDAY_ATTENDANCE',
          },
        ],
        totalCount: 1,
        summary: {
          holidayAttendance: 1,
          cancelledAttendance: 0,
          outOfTerm: 0,
          missingCalendarDay: 0,
        },
      }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    const result = await service.getReconciliationAnomalies(10, 1, 20, {
      id: 5,
      username: 'school-admin',
      roles: ['ADMIN'],
      permissions: ['attendance-dashboard'],
      data_scope: { school_ids: [10010002], grade_levels: [3] },
    });

    expect(repository.listSessionAnomalies).toHaveBeenCalledWith(
      expect.objectContaining({ id: '10', status: 'ACTIVE' }),
      expect.objectContaining({ school_ids: [10010002], grade_levels: [3] }),
      1,
      20,
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        sessionId: '4bf84262-c297-47f6-9c03-084416ac7652',
        date: '2026-05-10',
        grade: 'ป.3',
        room: 1,
        anomalyType: 'HOLIDAY_ATTENDANCE',
      }),
    ]);
    expect(result.summary.holidayAttendance).toBe(1);
  });
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TimetableRepository } from './timetable.repository';
import { generatePeriodTimes, TimetableService } from './timetable.service';
import type { SchoolPeriodTimeRow, TimetableSlotRow } from './timetable.types';

describe('TimetableService', () => {
  let service: TimetableService;
  let repository: jest.Mocked<
    Pick<
      TimetableRepository,
      | 'isSchoolInScope'
      | 'listForRoom'
      | 'listForTeacher'
      | 'listDistinctSubjectsForRoom'
      | 'listTeacherCandidatesForSchool'
      | 'isActiveTeacherForSchool'
      | 'resolveStudentRoom'
      | 'findById'
      | 'create'
      | 'update'
      | 'softDelete'
      | 'withTransaction'
      | 'listPeriodTimesForSchool'
      | 'countSlotsOutsidePeriods'
      | 'listDaysWithPeriodTimes'
      | 'replacePeriodTimesForDays'
      | 'upsertPeriodTimeOverride'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'recordAtomic'>>;

  function slotRow(overrides: Partial<TimetableSlotRow> = {}): TimetableSlotRow {
    return {
      id: '1',
      school_term_id: '1',
      school_id: 10010002,
      grade_level_id: 423,
      room_no: 1,
      day_of_week: 1,
      period: 1,
      subject_id: 5,
      subject_code: 'MATH101',
      subject_name_th: 'คณิตศาสตร์',
      teacher_user_id: null,
      teacher_name: null,
      created_at: new Date('2026-07-07T00:00:00Z'),
      updated_at: new Date('2026-07-07T00:00:00Z'),
      ...overrides,
    };
  }

  function periodTimeRow(overrides: Partial<SchoolPeriodTimeRow> = {}): SchoolPeriodTimeRow {
    return {
      id: '1',
      school_id: 10010002,
      day_of_week: 1,
      period: 1,
      starts_at: '08:30',
      ends_at: '09:20',
      source: 'GENERATED',
      created_at: new Date('2026-07-09T00:00:00Z'),
      updated_at: new Date('2026-07-09T00:00:00Z'),
      ...overrides,
    };
  }

  const globalActor = {
    id: 3,
    username: 'admin1',
    roles: ['ADMIN'],
    permissions: ['manage-timetable'],
    data_scope: { global: true },
  };
  const studentActor = {
    id: 4,
    username: 'student1',
    roles: ['STUDENT'],
    permissions: ['student-self'],
    data_scope: { own_only: true },
    student_uuid: '30000000-0000-4000-8000-000000000149',
  };

  beforeEach(() => {
    repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      listForRoom: jest.fn().mockResolvedValue([slotRow()]),
      listForTeacher: jest.fn().mockResolvedValue([slotRow({ teacher_user_id: 3 })]),
      listDistinctSubjectsForRoom: jest
        .fn()
        .mockResolvedValue([{ subject_id: 5, code: 'MATH101', name_th: 'คณิตศาสตร์' }]),
      listTeacherCandidatesForSchool: jest
        .fn()
        .mockResolvedValue([{ id: 8, display_name: 'ครูสมชาย ใจดี' }]),
      isActiveTeacherForSchool: jest.fn().mockResolvedValue(true),
      resolveStudentRoom: jest
        .fn()
        .mockResolvedValue({ school_id: 10010002, grade_level_id: 423, room_no: 1 }),
      findById: jest.fn().mockResolvedValue(slotRow()),
      create: jest.fn().mockResolvedValue({ id: '1' }),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn((operation) => operation({} as never)),
      listPeriodTimesForSchool: jest.fn().mockResolvedValue([periodTimeRow()]),
      countSlotsOutsidePeriods: jest.fn().mockResolvedValue(0),
      listDaysWithPeriodTimes: jest.fn().mockResolvedValue([1, 2, 3, 4, 5]),
      replacePeriodTimesForDays: jest.fn().mockResolvedValue(undefined),
      upsertPeriodTimeOverride: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    service = new TimetableService(
      repository as unknown as TimetableRepository,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('scope enforcement', () => {
    it('rejects listForRoom when the school is outside the actor scope', async () => {
      repository.isSchoolInScope.mockResolvedValue(false);
      await expect(service.listForRoom(globalActor, 999, 423, 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects create when the grade is outside a grade-scoped actor', async () => {
      const scopedActor = { ...globalActor, data_scope: { grade_levels: [999] } };
      await expect(
        service.create(scopedActor, {
          schoolTermId: 1,
          schoolId: 10010002,
          gradeLevelId: 423,
          roomNo: 1,
          dayOfWeek: 1,
          period: 1,
          subjectId: 5,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects update when the room is outside a room-scoped actor', async () => {
      const scopedActor = { ...globalActor, data_scope: { room_ids: [99] } };
      await expect(service.update(scopedActor, '1', { subjectId: 6 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a slot and audits TIMETABLE_SLOT_CREATE', async () => {
      const result = await service.create(globalActor, {
        schoolTermId: 1,
        schoolId: 10010002,
        gradeLevelId: 423,
        roomNo: 1,
        dayOfWeek: 1,
        period: 1,
        subjectId: 5,
      });

      expect(result.data.id).toBe('1');
      expect(auditLog.recordAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TIMETABLE_SLOT_CREATE' }),
        expect.anything(),
      );
    });

    it('maps a duplicate day/period violation to ConflictException', async () => {
      repository.create.mockRejectedValue({ code: '23505' });
      await expect(
        service.create(globalActor, {
          schoolTermId: 1,
          schoolId: 10010002,
          gradeLevelId: 423,
          roomNo: 1,
          dayOfWeek: 1,
          period: 1,
          subjectId: 5,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a teacher who is not an active member of the selected school', async () => {
      repository.isActiveTeacherForSchool.mockResolvedValue(false);

      await expect(
        service.create(globalActor, {
          schoolTermId: 1,
          schoolId: 10010002,
          gradeLevelId: 423,
          roomNo: 1,
          dayOfWeek: 1,
          period: 1,
          subjectId: 5,
          teacherUserId: 99,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects a teacher who is not an active member of the slot school', async () => {
      repository.isActiveTeacherForSchool.mockResolvedValue(false);

      await expect(service.update(globalActor, '1', { teacherUserId: 99 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes and audits TIMETABLE_SLOT_DELETE', async () => {
      await service.remove(globalActor, '1');
      expect(repository.softDelete).toHaveBeenCalledWith('1', globalActor.id, expect.anything());
      expect(auditLog.recordAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TIMETABLE_SLOT_DELETE' }),
        expect.anything(),
      );
    });
  });

  describe('getMySchedule', () => {
    it('a student always sees their own room, ignoring filters', async () => {
      const studentActor = {
        ...globalActor,
        roles: ['STUDENT'],
        student_uuid: 'stu-1',
        data_scope: {},
      };
      const result = await service.getMySchedule(studentActor, { schoolId: 1 });

      expect(repository.resolveStudentRoom).toHaveBeenCalledWith('stu-1');
      expect(repository.listForRoom).toHaveBeenCalledWith(10010002, 423, 1);
      expect(result.data).toHaveLength(1);
    });

    it('a student with no resolvable room gets an empty schedule, not an error', async () => {
      repository.resolveStudentRoom.mockResolvedValue(null);
      const studentActor = {
        ...globalActor,
        roles: ['STUDENT'],
        student_uuid: 'stu-1',
        data_scope: {},
      };
      const result = await service.getMySchedule(studentActor, {});
      expect(result).toEqual({ success: true, data: [] });
    });

    it('mine=true returns only the periods the actor teaches', async () => {
      const result = await service.getMySchedule(globalActor, { mine: true });
      expect(repository.listForTeacher).toHaveBeenCalledWith(globalActor.id);
      expect(result.data).toHaveLength(1);
    });

    it('requires explicit school/grade/room filters for the staff view', async () => {
      await expect(service.getMySchedule(globalActor, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('applies scope-enforced listForRoom for the explicit staff view', async () => {
      const result = await service.getMySchedule(globalActor, {
        schoolId: 10010002,
        gradeLevelId: 423,
        roomNo: 1,
      });
      expect(repository.isSchoolInScope).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });
  });

  describe('listTeacherCandidates', () => {
    it('returns narrow teacher candidates for an in-scope school', async () => {
      const result = await service.listTeacherCandidates(globalActor, 10010002, 'สมชาย');

      expect(repository.isSchoolInScope).toHaveBeenCalledWith(10010002, globalActor.data_scope);
      expect(repository.listTeacherCandidatesForSchool).toHaveBeenCalledWith(10010002, 'สมชาย');
      expect(result).toEqual({
        success: true,
        data: [{ id: 8, display_name: 'ครูสมชาย ใจดี' }],
      });
    });

    it('rejects teacher candidates when the school is outside actor scope', async () => {
      repository.isSchoolInScope.mockResolvedValue(false);

      await expect(service.listTeacherCandidates(globalActor, 999)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.listTeacherCandidatesForSchool).not.toHaveBeenCalled();
    });
  });

  describe('generatePeriodTimes (pure)', () => {
    it('lays out contiguous periods with no breaks configured', () => {
      const periods = generatePeriodTimes({
        schoolId: 10010002,
        daysOfWeek: [1],
        periodsCount: 3,
        firstPeriodStartsAt: '08:30',
        periodLengthMinutes: 50,
      });

      expect(periods).toEqual([
        { period: 1, startsAt: '08:30', endsAt: '09:20' },
        { period: 2, startsAt: '09:20', endsAt: '10:10' },
        { period: 3, startsAt: '10:10', endsAt: '11:00' },
      ]);
    });

    it('inserts a morning break and lunch gap after the configured periods', () => {
      const periods = generatePeriodTimes({
        schoolId: 10010002,
        daysOfWeek: [1],
        periodsCount: 5,
        firstPeriodStartsAt: '08:30',
        periodLengthMinutes: 50,
        breakAfterPeriod: 1,
        breakMinutes: 10,
        lunchAfterPeriod: 4,
        lunchMinutes: 70,
      });

      expect(periods[0]).toEqual({ period: 1, startsAt: '08:30', endsAt: '09:20' });
      // 10-minute break after period 1: period 2 starts at 09:30, not 09:20.
      expect(periods[1]).toEqual({ period: 2, startsAt: '09:30', endsAt: '10:20' });
      expect(periods[3]).toEqual({ period: 4, startsAt: '11:10', endsAt: '12:00' });
      // 70-minute lunch after period 4: period 5 starts at 13:10, not 12:00.
      expect(periods[4]).toEqual({ period: 5, startsAt: '13:10', endsAt: '14:00' });
    });

    it('matches the current hardcoded PERIOD_TIME_LABELS schedule with the real break config', () => {
      const periods = generatePeriodTimes({
        schoolId: 10010002,
        daysOfWeek: [1],
        periodsCount: 8,
        firstPeriodStartsAt: '08:30',
        periodLengthMinutes: 50,
        lunchAfterPeriod: 4,
        lunchMinutes: 70,
      });

      expect(periods.map((p) => `${p.startsAt}-${p.endsAt}`)).toEqual([
        '08:30-09:20',
        '09:20-10:10',
        '10:10-11:00',
        '11:00-11:50',
        '13:00-13:50',
        '13:50-14:40',
        '14:40-15:30',
        '15:30-16:20',
      ]);
    });
  });

  describe('listPeriodTimes', () => {
    it('returns period times for an in-scope school', async () => {
      const result = await service.listPeriodTimes(globalActor, 10010002);

      expect(repository.isSchoolInScope).toHaveBeenCalledWith(10010002, globalActor.data_scope);
      expect(result).toEqual({
        success: true,
        data: [
          {
            id: '1',
            school_id: 10010002,
            day_of_week: 1,
            period: 1,
            starts_at: '08:30',
            ends_at: '09:20',
            source: 'GENERATED',
          },
        ],
      });
    });

    it('rejects when the school is outside actor scope', async () => {
      repository.isSchoolInScope.mockResolvedValue(false);

      await expect(service.listPeriodTimes(globalActor, 999)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.listPeriodTimesForSchool).not.toHaveBeenCalled();
    });

    it('allows a student to read period times for their own enrolled school', async () => {
      await service.listPeriodTimes(studentActor, 10010002);

      expect(repository.resolveStudentRoom).toHaveBeenCalledWith(studentActor.student_uuid);
      expect(repository.isSchoolInScope).not.toHaveBeenCalled();
      expect(repository.listPeriodTimesForSchool).toHaveBeenCalledWith(10010002);
    });

    it('rejects a student reading period times for another school', async () => {
      await expect(service.listPeriodTimes(studentActor, 999)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(repository.resolveStudentRoom).toHaveBeenCalledWith(studentActor.student_uuid);
      expect(repository.listPeriodTimesForSchool).not.toHaveBeenCalled();
    });
  });

  describe('generatePeriodTimesForSchool', () => {
    it('replaces period times for the selected days and audits the action', async () => {
      const result = await service.generatePeriodTimesForSchool(globalActor, {
        schoolId: 10010002,
        daysOfWeek: [1, 2, 3, 4, 5],
        periodsCount: 8,
        firstPeriodStartsAt: '08:30',
        periodLengthMinutes: 50,
        lunchAfterPeriod: 4,
        lunchMinutes: 70,
      });

      expect(repository.replacePeriodTimesForDays).toHaveBeenCalledWith(
        10010002,
        [1, 2, 3, 4, 5],
        expect.arrayContaining([{ period: 1, startsAt: '08:30', endsAt: '09:20' }]),
        globalActor.id,
        expect.anything(),
      );
      expect(auditLog.recordAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PERIOD_TIME_GENERATE' }),
        expect.anything(),
      );
      expect(result.success).toBe(true);
    });

    it('rejects generation when the school is outside actor scope', async () => {
      repository.isSchoolInScope.mockResolvedValue(false);

      await expect(
        service.generatePeriodTimesForSchool(globalActor, {
          schoolId: 999,
          daysOfWeek: [1],
          periodsCount: 1,
          firstPeriodStartsAt: '08:30',
          periodLengthMinutes: 50,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.replacePeriodTimesForDays).not.toHaveBeenCalled();
    });

    it('rejects shrinking the schedule when a subject is still assigned to a dropped period', async () => {
      repository.countSlotsOutsidePeriods.mockResolvedValue(2);

      await expect(
        service.generatePeriodTimesForSchool(globalActor, {
          schoolId: 10010002,
          daysOfWeek: [1, 2, 3, 4, 5],
          periodsCount: 7,
          firstPeriodStartsAt: '08:30',
          periodLengthMinutes: 50,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.countSlotsOutsidePeriods).toHaveBeenCalledWith(
        10010002,
        [1, 2, 3, 4, 5],
        [1, 2, 3, 4, 5, 6, 7],
        expect.anything(),
      );
      expect(repository.replacePeriodTimesForDays).not.toHaveBeenCalled();
    });

    it('rejects dropping a day that still has an assigned subject', async () => {
      repository.listDaysWithPeriodTimes.mockResolvedValue([1, 2, 3, 4, 5, 6]);
      repository.countSlotsOutsidePeriods.mockImplementation((_schoolId, days) =>
        Promise.resolve(days.includes(6) ? 1 : 0),
      );

      await expect(
        service.generatePeriodTimesForSchool(globalActor, {
          schoolId: 10010002,
          daysOfWeek: [1, 2, 3, 4, 5],
          periodsCount: 8,
          firstPeriodStartsAt: '08:30',
          periodLengthMinutes: 50,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.countSlotsOutsidePeriods).toHaveBeenCalledWith(
        10010002,
        [6],
        [],
        expect.anything(),
      );
      expect(repository.replacePeriodTimesForDays).not.toHaveBeenCalled();
    });

    it('clears a dropped day with no assigned subjects alongside the regenerate', async () => {
      repository.listDaysWithPeriodTimes.mockResolvedValue([1, 2, 3, 4, 5, 6]);

      await service.generatePeriodTimesForSchool(globalActor, {
        schoolId: 10010002,
        daysOfWeek: [1, 2, 3, 4, 5],
        periodsCount: 8,
        firstPeriodStartsAt: '08:30',
        periodLengthMinutes: 50,
      });

      expect(repository.replacePeriodTimesForDays).toHaveBeenCalledWith(
        10010002,
        [6],
        [],
        globalActor.id,
        expect.anything(),
      );
      expect(repository.replacePeriodTimesForDays).toHaveBeenCalledWith(
        10010002,
        [1, 2, 3, 4, 5],
        expect.arrayContaining([{ period: 1, startsAt: '08:30', endsAt: '09:20' }]),
        globalActor.id,
        expect.anything(),
      );
    });
  });

  describe('overridePeriodTime', () => {
    it('upserts a single period override and audits the action', async () => {
      const result = await service.overridePeriodTime(globalActor, {
        schoolId: 10010002,
        dayOfWeek: 1,
        period: 1,
        startsAt: '08:00',
        endsAt: '08:45',
      });

      expect(repository.upsertPeriodTimeOverride).toHaveBeenCalledWith(
        10010002,
        1,
        1,
        '08:00',
        '08:45',
        globalActor.id,
        expect.anything(),
      );
      expect(auditLog.recordAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PERIOD_TIME_OVERRIDE' }),
        expect.anything(),
      );
      expect(result.success).toBe(true);
    });

    it('rejects an override where ends_at is not after starts_at', async () => {
      await expect(
        service.overridePeriodTime(globalActor, {
          schoolId: 10010002,
          dayOfWeek: 1,
          period: 1,
          startsAt: '09:00',
          endsAt: '08:45',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.upsertPeriodTimeOverride).not.toHaveBeenCalled();
    });
  });
});

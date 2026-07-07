import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TimetableRepository } from './timetable.repository';
import { TimetableService } from './timetable.service';
import type { TimetableSlotRow } from './timetable.types';

describe('TimetableService', () => {
  let service: TimetableService;
  let repository: jest.Mocked<
    Pick<
      TimetableRepository,
      | 'isSchoolInScope'
      | 'listForRoom'
      | 'listForTeacher'
      | 'listDistinctSubjectsForRoom'
      | 'resolveStudentRoom'
      | 'findById'
      | 'create'
      | 'update'
      | 'softDelete'
      | 'withTransaction'
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

  const globalActor = {
    id: 3,
    username: 'admin1',
    roles: ['ADMIN'],
    permissions: ['manage-timetable'],
    data_scope: { global: true },
  };

  beforeEach(() => {
    repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      listForRoom: jest.fn().mockResolvedValue([slotRow()]),
      listForTeacher: jest.fn().mockResolvedValue([slotRow({ teacher_user_id: 3 })]),
      listDistinctSubjectsForRoom: jest
        .fn()
        .mockResolvedValue([{ subject_id: 5, code: 'MATH101', name_th: 'คณิตศาสตร์' }]),
      resolveStudentRoom: jest
        .fn()
        .mockResolvedValue({ school_id: 10010002, grade_level_id: 423, room_no: 1 }),
      findById: jest.fn().mockResolvedValue(slotRow()),
      create: jest.fn().mockResolvedValue({ id: '1' }),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn((operation) => operation({} as never)),
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
});

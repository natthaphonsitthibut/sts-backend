import { AuditLogService } from '../audit-log/audit-log.service';
import { AutomationRepository } from './automation.repository';
import { AbsenceMonitorService } from './absence-monitor.service';
import type { ConsecutiveAbsentStudentRow } from './automation.types';

function buildAbsentStudent(
  overrides: Partial<ConsecutiveAbsentStudentRow> = {},
): ConsecutiveAbsentStudentRow {
  return {
    student_uuid: 'student-uuid-1',
    consecutive_days: 3,
    first_name_onec: 'สมชาย',
    last_name_onec: 'ใจดี',
    school_id_onec: 10010002,
    village_number_onec: null,
    street_onec: null,
    soi_onec: null,
    sub_district_name_thai_onec: null,
    district_name_thai_onec: null,
    province_name_thai_onec: null,
    school_name: 'โรงเรียนทดสอบ',
    ...overrides,
  };
}

describe('AbsenceMonitorService', () => {
  let service: AbsenceMonitorService;
  let automationRepository: jest.Mocked<
    Pick<
      AutomationRepository,
      | 'getSystemSettingValue'
      | 'withTransaction'
      | 'listConsecutiveAbsentStudents'
      | 'listOpenAbsenceCases'
      | 'deleteOpenCaseById'
      | 'findActiveAbsenceCaseByStudent'
      | 'createAutomatedCase'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  beforeEach(() => {
    automationRepository = {
      getSystemSettingValue: jest.fn().mockResolvedValue('3'),
      withTransaction: jest.fn(async (callback) => {
        await callback(undefined);
      }),
      listConsecutiveAbsentStudents: jest.fn().mockResolvedValue([]),
      listOpenAbsenceCases: jest.fn().mockResolvedValue([]),
      deleteOpenCaseById: jest.fn().mockResolvedValue(true),
      findActiveAbsenceCaseByStudent: jest.fn().mockResolvedValue(null),
      createAutomatedCase: jest.fn().mockResolvedValue(77),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new AbsenceMonitorService(
      automationRepository as unknown as AutomationRepository,
      auditLog as unknown as AuditLogService,
    );
  });

  it('audits soft-cancelled open absence cases after attendance correction', async () => {
    automationRepository.listOpenAbsenceCases.mockResolvedValue([
      {
        id: 10,
        student_name: 'สมชาย ใจดี',
        student_uuid: 'student-uuid-1',
        school_id: 10010002,
      },
    ]);

    await service.checkConsecutiveAbsences();

    expect(automationRepository.deleteOpenCaseById).toHaveBeenCalledWith(10, undefined);
    expect(auditLog.record).toHaveBeenCalledWith({
      actorUserId: null,
      actorLabel: 'system:absence-monitor',
      action: 'CASE_AUTO_CANCEL',
      targetType: 'case',
      targetId: '10',
      metadata: {
        reason: 'attendance_corrected',
        studentUuid: 'student-uuid-1',
      },
      ip: null,
    });
  });

  it('does not create a duplicate when an active absence case already exists', async () => {
    automationRepository.listConsecutiveAbsentStudents.mockResolvedValue([buildAbsentStudent()]);
    automationRepository.findActiveAbsenceCaseByStudent.mockResolvedValue(20);

    const result = await service.checkConsecutiveAbsences();

    expect(result).toEqual([]);
    expect(automationRepository.findActiveAbsenceCaseByStudent).toHaveBeenCalledWith(
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
      undefined,
    );
    expect(automationRepository.createAutomatedCase).not.toHaveBeenCalled();
  });

  it('does not retain a legacy case only because the same student name is absent in another school', async () => {
    automationRepository.listConsecutiveAbsentStudents.mockResolvedValue([
      buildAbsentStudent({
        student_uuid: 'student-uuid-1',
        school_id_onec: 10010002,
      }),
    ]);
    automationRepository.listOpenAbsenceCases.mockResolvedValue([
      {
        id: 30,
        student_name: 'สมชาย ใจดี',
        student_uuid: null,
        school_id: 20020003,
      },
    ]);

    await service.checkConsecutiveAbsences();

    expect(automationRepository.deleteOpenCaseById).toHaveBeenCalledWith(30, undefined);
  });
});

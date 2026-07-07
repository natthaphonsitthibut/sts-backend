import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
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
      | 'listEvaluableStudentUuids'
      | 'listOpenAbsenceCases'
      | 'deleteOpenCaseById'
      | 'findActiveAbsenceCaseByStudent'
      | 'createAutomatedCase'
      | 'escalateCaseRiskTier'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'notifyCaseCreated' | 'notifyCaseRiskEscalated'>
  >;
  let riskProfileService: jest.Mocked<Pick<RiskProfileService, 'enqueueStudents'>>;

  beforeEach(() => {
    automationRepository = {
      getSystemSettingValue: jest.fn().mockImplementation((key: string) => {
        const values: Record<string, string> = {
          CASE_RISK_LOW_ABSENCE_DAYS: '3',
          CASE_RISK_MEDIUM_ABSENCE_DAYS: '5',
          CASE_RISK_HIGH_ABSENCE_DAYS: '7',
          CASE_SLA_HIGH_DAYS: '3',
          CASE_SLA_MEDIUM_DAYS: '7',
          CASE_SLA_LOW_DAYS: '14',
        };
        return Promise.resolve(values[key] ?? null);
      }),
      withTransaction: jest.fn(async (callback) => {
        await callback(undefined);
      }),
      listConsecutiveAbsentStudents: jest.fn().mockResolvedValue([]),
      listEvaluableStudentUuids: jest.fn().mockResolvedValue([]),
      listOpenAbsenceCases: jest.fn().mockResolvedValue([]),
      deleteOpenCaseById: jest.fn().mockResolvedValue(true),
      findActiveAbsenceCaseByStudent: jest.fn().mockResolvedValue(null),
      createAutomatedCase: jest.fn().mockResolvedValue(77),
      escalateCaseRiskTier: jest.fn().mockResolvedValue(true),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notifyCaseCreated: jest.fn().mockResolvedValue(undefined),
      notifyCaseRiskEscalated: jest.fn().mockResolvedValue(undefined),
    };
    riskProfileService = {
      enqueueStudents: jest.fn().mockResolvedValue(undefined),
    };

    service = new AbsenceMonitorService(
      automationRepository as unknown as AutomationRepository,
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
      riskProfileService as unknown as RiskProfileService,
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
    automationRepository.listEvaluableStudentUuids.mockResolvedValue(['student-uuid-1']);

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
    expect(riskProfileService.enqueueStudents).toHaveBeenCalledWith(
      ['student-uuid-1'],
      'case-auto-monitor',
    );
  });

  it('does not create a duplicate when an active absence case already exists', async () => {
    automationRepository.listConsecutiveAbsentStudents.mockResolvedValue([buildAbsentStudent()]);
    automationRepository.findActiveAbsenceCaseByStudent.mockResolvedValue({
      id: 20,
      risk_tier: 'LOW',
    });

    const result = await service.checkConsecutiveAbsences();

    expect(result).toEqual([]);
    expect(automationRepository.findActiveAbsenceCaseByStudent).toHaveBeenCalledWith(
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
      undefined,
    );
    expect(automationRepository.createAutomatedCase).not.toHaveBeenCalled();
    expect(automationRepository.escalateCaseRiskTier).not.toHaveBeenCalled();
    expect(notificationsService.notifyCaseCreated).not.toHaveBeenCalled();
  });

  it('escalates the existing case tier when the streak crosses a higher threshold', async () => {
    automationRepository.getSystemSettingValue.mockImplementation((key) => {
      const values: Record<string, string> = {
        CASE_RISK_LOW_ABSENCE_DAYS: '3',
        CASE_RISK_HIGH_ABSENCE_DAYS: '7',
        CASE_RISK_MEDIUM_ABSENCE_DAYS: '5',
        CASE_SLA_HIGH_DAYS: '3',
        CASE_SLA_MEDIUM_DAYS: '7',
        CASE_SLA_LOW_DAYS: '14',
      };
      return Promise.resolve(values[key] ?? null);
    });
    automationRepository.listConsecutiveAbsentStudents.mockResolvedValue([
      buildAbsentStudent({ consecutive_days: 5 }),
    ]);
    automationRepository.findActiveAbsenceCaseByStudent.mockResolvedValue({
      id: 20,
      risk_tier: 'LOW',
    });

    const result = await service.checkConsecutiveAbsences();

    expect(result).toEqual([]);
    expect(automationRepository.createAutomatedCase).not.toHaveBeenCalled();
    expect(automationRepository.escalateCaseRiskTier).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 20,
        riskTier: 'MEDIUM',
        reason: 'ขาดเรียนติดต่อกัน 5 วัน',
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith({
      actorUserId: null,
      actorLabel: 'system:absence-monitor',
      action: 'CASE_RISK_TIER_ESCALATE',
      targetType: 'case',
      targetId: '20',
      metadata: {
        reason: 'consecutive_absence_growth',
        studentUuid: 'student-uuid-1',
        fromTier: 'LOW',
        toTier: 'MEDIUM',
        consecutiveDays: 5,
      },
      ip: null,
    });
    expect(notificationsService.notifyCaseRiskEscalated).toHaveBeenCalledWith({
      caseId: 20,
      studentName: 'สมชาย ใจดี',
      schoolId: 10010002,
      fromTier: 'LOW',
      toTier: 'MEDIUM',
      reason: 'ขาดเรียนติดต่อกัน 5 วัน',
    });
    expect(riskProfileService.enqueueStudents).toHaveBeenCalledWith(
      ['student-uuid-1'],
      'case-auto-monitor',
    );
  });

  it('does not escalate or downgrade when the streak stays within the current tier', async () => {
    automationRepository.listConsecutiveAbsentStudents.mockResolvedValue([
      buildAbsentStudent({ consecutive_days: 4 }),
    ]);
    automationRepository.findActiveAbsenceCaseByStudent.mockResolvedValue({
      id: 21,
      risk_tier: 'HIGH',
    });

    await service.checkConsecutiveAbsences();

    expect(automationRepository.escalateCaseRiskTier).not.toHaveBeenCalled();
    expect(notificationsService.notifyCaseRiskEscalated).not.toHaveBeenCalled();
  });

  it('notifies eligible staff after creating an absence case', async () => {
    automationRepository.getSystemSettingValue.mockImplementation((key) => {
      const values: Record<string, string> = {
        CASE_RISK_LOW_ABSENCE_DAYS: '3',
        CASE_RISK_HIGH_ABSENCE_DAYS: '7',
        CASE_RISK_MEDIUM_ABSENCE_DAYS: '5',
        CASE_SLA_HIGH_DAYS: '3',
        CASE_SLA_MEDIUM_DAYS: '7',
        CASE_SLA_LOW_DAYS: '14',
      };
      return Promise.resolve(values[key] ?? null);
    });
    automationRepository.listConsecutiveAbsentStudents.mockResolvedValue([
      buildAbsentStudent({ consecutive_days: 7 }),
    ]);

    const result = await service.checkConsecutiveAbsences();

    expect(result).toEqual([
      {
        case_id: 77,
        student_name: 'สมชาย ใจดี',
        student_school: 'โรงเรียนทดสอบ',
        reason_flagged: 'ขาดเรียนติดต่อกัน 7 วัน',
        school_id: 10010002,
      },
    ]);
    expect(notificationsService.notifyCaseCreated).toHaveBeenCalledWith({
      caseId: 77,
      studentName: 'สมชาย ใจดี',
      schoolId: 10010002,
      schoolName: 'โรงเรียนทดสอบ',
      reason: 'ขาดเรียนติดต่อกัน 7 วัน',
    });
    const createdInput = automationRepository.createAutomatedCase.mock.calls[0]?.[0];
    expect(createdInput?.riskTier).toBe('HIGH');
    expect(createdInput?.slaDueAt).toBeInstanceOf(Date);
    expect(riskProfileService.enqueueStudents).toHaveBeenCalledWith(
      ['student-uuid-1'],
      'case-auto-monitor',
    );
  });

  it('does not enqueue a risk profile refresh when nothing changed', async () => {
    await service.checkConsecutiveAbsences();

    expect(riskProfileService.enqueueStudents).not.toHaveBeenCalled();
  });

  it('does not auto-cancel a legacy case without a stable student uuid', async () => {
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

    expect(automationRepository.deleteOpenCaseById).not.toHaveBeenCalled();
  });
});

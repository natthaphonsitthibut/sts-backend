import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AutomationRepository } from './automation.repository';
import { AbsenceMonitorService } from './absence-monitor.service';
import type { CumulativeAbsentStudentRow } from './automation.types';

function buildAbsentStudent(
  overrides: Partial<CumulativeAbsentStudentRow> = {},
): CumulativeAbsentStudentRow {
  return {
    student_uuid: 'student-uuid-1',
    absent_days_since_case_reset: 3,
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
      | 'lockStudentAbsenceChecks'
      | 'listCumulativeAbsentStudents'
      | 'listEvaluableStudentUuids'
      | 'listOpenAbsenceCases'
      | 'deleteOpenCaseById'
      | 'findActiveAbsenceCaseByStudent'
      | 'createAutomatedCase'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyCaseStatusChanged'>>;
  let riskProfileService: jest.Mocked<Pick<RiskProfileService, 'requestStudentRecalculation'>>;

  beforeEach(() => {
    automationRepository = {
      getSystemSettingValue: jest.fn().mockImplementation((key: string) => {
        const values: Record<string, string> = {
          CASE_RISK_HIGH_ABSENCE_DAYS: '3',
        };
        return Promise.resolve(values[key] ?? null);
      }),
      withTransaction: jest.fn(async (callback) => {
        await callback(undefined);
      }),
      lockStudentAbsenceChecks: jest.fn().mockResolvedValue(undefined),
      listCumulativeAbsentStudents: jest.fn().mockResolvedValue([]),
      listEvaluableStudentUuids: jest.fn().mockResolvedValue([]),
      listOpenAbsenceCases: jest.fn().mockResolvedValue([]),
      deleteOpenCaseById: jest.fn().mockResolvedValue(true),
      findActiveAbsenceCaseByStudent: jest.fn().mockResolvedValue(null),
      createAutomatedCase: jest.fn().mockResolvedValue(77),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notifyCaseStatusChanged: jest.fn().mockResolvedValue(undefined),
    };
    riskProfileService = {
      requestStudentRecalculation: jest.fn().mockResolvedValue(undefined),
    };

    service = new AbsenceMonitorService(
      automationRepository as unknown as AutomationRepository,
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
      riskProfileService as unknown as RiskProfileService,
    );
  });

  it('skips an empty roster without sweeping the whole database', async () => {
    expect(await service.checkConsecutiveAbsences([])).toEqual([]);
    expect(automationRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('checks only the committed roster and locks it before finding candidates', async () => {
    const roster = ['student-uuid-1'];
    await service.checkConsecutiveAbsences(roster);
    expect(automationRepository.lockStudentAbsenceChecks).toHaveBeenCalledWith(roster, undefined);
    expect(automationRepository.listCumulativeAbsentStudents).toHaveBeenCalledWith(
      3,
      expect.any(String),
      undefined,
      roster,
    );
    expect(automationRepository.listOpenAbsenceCases).toHaveBeenCalledWith(undefined, roster);
    expect(automationRepository.lockStudentAbsenceChecks.mock.invocationCallOrder[0]).toBeLessThan(
      automationRepository.listCumulativeAbsentStudents.mock.invocationCallOrder[0],
    );
  });

  it('does not duplicate a case or alert on repeated checks', async () => {
    automationRepository.listCumulativeAbsentStudents.mockResolvedValue([buildAbsentStudent()]);
    automationRepository.findActiveAbsenceCaseByStudent
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 77, status: 'OPEN', risk_tier: 'HIGH' });
    await service.checkConsecutiveAbsences(['student-uuid-1']);
    await service.checkConsecutiveAbsences(['student-uuid-1']);
    expect(automationRepository.createAutomatedCase).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyCaseStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('propagates transaction failure without sending a success notification', async () => {
    automationRepository.withTransaction.mockRejectedValue(new Error('database unavailable'));
    await expect(service.checkConsecutiveAbsences(['student-uuid-1'])).rejects.toThrow(
      'database unavailable',
    );
    expect(notificationsService.notifyCaseStatusChanged).not.toHaveBeenCalled();
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
    expect(riskProfileService.requestStudentRecalculation).toHaveBeenCalledWith(
      ['student-uuid-1'],
      'case-auto-monitor',
      true,
    );
  });

  it('does not create a duplicate when an active absence case already exists', async () => {
    automationRepository.listCumulativeAbsentStudents.mockResolvedValue([buildAbsentStudent()]);
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
    expect(notificationsService.notifyCaseStatusChanged).not.toHaveBeenCalled();
  });

  it('notifies eligible staff after creating an absence case', async () => {
    automationRepository.getSystemSettingValue.mockImplementation((key) => {
      const values: Record<string, string> = {
        CASE_RISK_HIGH_ABSENCE_DAYS: '3',
      };
      return Promise.resolve(values[key] ?? null);
    });
    automationRepository.listCumulativeAbsentStudents.mockResolvedValue([
      buildAbsentStudent({ absent_days_since_case_reset: 7 }),
    ]);

    const result = await service.checkConsecutiveAbsences();

    expect(result).toEqual([
      {
        case_id: 77,
        student_name: 'สมชาย ใจดี',
        student_school: 'โรงเรียนทดสอบ',
        reason_flagged: 'ขาดเรียนหลังปิดเคสล่าสุด 7 วัน',
        school_id: 10010002,
      },
    ]);
    expect(notificationsService.notifyCaseStatusChanged).toHaveBeenCalledWith({
      caseId: 77,
      studentName: 'สมชาย ใจดี',
      schoolId: 10010002,
      nextStatus: 'OPEN',
      actorUserId: null,
    });
    const createdInput = automationRepository.createAutomatedCase.mock.calls[0]?.[0];
    expect(createdInput?.riskTier).toBe('HIGH');
    expect(riskProfileService.requestStudentRecalculation).toHaveBeenCalledWith(
      ['student-uuid-1'],
      'case-auto-monitor',
      true,
    );
  });

  it('does not enqueue a risk profile refresh when nothing changed', async () => {
    await service.checkConsecutiveAbsences();

    expect(riskProfileService.requestStudentRecalculation).not.toHaveBeenCalled();
  });

  it('does not auto-cancel a legacy case without a stable student uuid', async () => {
    automationRepository.listCumulativeAbsentStudents.mockResolvedValue([
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

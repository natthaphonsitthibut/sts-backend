import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AutomationRepository } from './automation.repository';
import { SubjectRiskMonitorService } from './subject-risk-monitor.service';
import type { SubjectLateWatchRow, SubjectRiskCandidateRow } from './automation.types';

function buildRiskCandidate(
  overrides: Partial<SubjectRiskCandidateRow> = {},
): SubjectRiskCandidateRow {
  return {
    signal_code: 'MIXED_SUBJECT_ABSENCE',
    student_uuid: '11111111-1111-4111-8111-111111111111',
    metric_value: 3,
    threshold_value: 3,
    subject_id: null,
    subject_name_th: null,
    subject_code: null,
    first_name_onec: 'สมชาย',
    last_name_onec: 'ใจดี',
    school_id_onec: 10010002,
    village_number_onec: null,
    street_onec: null,
    soi_onec: null,
    sub_district_name_thai_onec: null,
    district_name_thai_onec: null,
    province_name_thai_onec: null,
    grade_level_id_onec: 6,
    room_id_onec: 1,
    school_name: 'โรงเรียนทดสอบ',
    ...overrides,
  };
}

function buildLateWatch(overrides: Partial<SubjectLateWatchRow> = {}): SubjectLateWatchRow {
  return {
    student_uuid: '22222222-2222-4222-8222-222222222222',
    late_count: 5,
    threshold_value: 5,
    first_name_onec: 'สมหญิง',
    last_name_onec: 'ตั้งใจ',
    school_id_onec: 10010002,
    grade_level_id_onec: 6,
    room_id_onec: 1,
    school_name: 'โรงเรียนทดสอบ',
    ...overrides,
  };
}

describe('SubjectRiskMonitorService', () => {
  let service: SubjectRiskMonitorService;
  let automationRepository: jest.Mocked<
    Pick<
      AutomationRepository,
      | 'getSystemSettingValue'
      | 'withTransaction'
      | 'listSubjectRiskCandidates'
      | 'findActiveAttendanceRiskCaseByStudent'
      | 'hasSystemCaseReviewNote'
      | 'insertSystemCaseReviewNote'
      | 'escalateCaseRiskTier'
      | 'createAutomatedCase'
      | 'listSubjectLateWatchCandidates'
      | 'hasRiskWatchNotification'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let notificationsService: jest.Mocked<
    Pick<
      NotificationsService,
      'notifyCaseCreated' | 'notifyCaseRiskEscalated' | 'notifyStudentRiskWatch'
    >
  >;
  let riskProfileService: jest.Mocked<Pick<RiskProfileService, 'enqueueStudents'>>;

  beforeEach(() => {
    const settings: Record<string, string> = {
      SUBJECT_RISK_MIXED_ABSENCE_WINDOW_DAYS: '7',
      SUBJECT_RISK_MIXED_ABSENCE_DAYS: '3',
      SUBJECT_RISK_AVOIDANCE_WINDOW_DAYS: '30',
      SUBJECT_RISK_AVOIDANCE_CONSECUTIVE_PERIODS: '3',
      SUBJECT_RISK_AVOIDANCE_ABSENT_PERCENT: '30',
      SUBJECT_RISK_LATE_WINDOW_DAYS: '30',
      SUBJECT_RISK_LATE_WATCH_COUNT: '5',
      CASE_RISK_TERM_ABSENCE_DAYS: '7',
      CASE_RISK_HIGH_ATTENDANCE_PERCENT: '80',
      CASE_SLA_HIGH_DAYS: '3',
      CASE_SLA_MEDIUM_DAYS: '7',
    };
    automationRepository = {
      getSystemSettingValue: jest.fn((key: string) => Promise.resolve(settings[key] ?? null)),
      withTransaction: jest.fn(async (callback) => {
        await callback(undefined);
      }),
      listSubjectRiskCandidates: jest.fn().mockResolvedValue([]),
      findActiveAttendanceRiskCaseByStudent: jest.fn().mockResolvedValue(null),
      hasSystemCaseReviewNote: jest.fn().mockResolvedValue(false),
      insertSystemCaseReviewNote: jest.fn().mockResolvedValue(undefined),
      escalateCaseRiskTier: jest.fn().mockResolvedValue(true),
      createAutomatedCase: jest.fn().mockResolvedValue(88),
      listSubjectLateWatchCandidates: jest.fn().mockResolvedValue([]),
      hasRiskWatchNotification: jest.fn().mockResolvedValue(false),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      notifyCaseCreated: jest.fn().mockResolvedValue(undefined),
      notifyCaseRiskEscalated: jest.fn().mockResolvedValue(undefined),
      notifyStudentRiskWatch: jest.fn().mockResolvedValue(undefined),
    };
    riskProfileService = { enqueueStudents: jest.fn().mockResolvedValue(undefined) };

    service = new SubjectRiskMonitorService(
      automationRepository as unknown as AutomationRepository,
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
      riskProfileService as unknown as RiskProfileService,
    );
  });

  it('creates a medium case for mixed subject absence without touching daily absence logic', async () => {
    automationRepository.listSubjectRiskCandidates.mockResolvedValue([buildRiskCandidate()]);

    const result = await service.checkSubjectRiskSignals();

    expect(result).toEqual([
      {
        case_id: 88,
        student_name: 'สมชาย ใจดี',
        student_school: 'โรงเรียนทดสอบ',
        reason_flagged: 'โดดคาบ: มาเรียนบางคาบแต่ขาดบางคาบ 3 วัน (เกณฑ์ 3 วัน)',
        school_id: 10010002,
      },
    ]);
    expect(automationRepository.createAutomatedCase).toHaveBeenCalledWith(
      expect.objectContaining({
        studentName: 'สมชาย ใจดี',
        riskTier: 'MEDIUM',
        reason: 'โดดคาบ: มาเรียนบางคาบแต่ขาดบางคาบ 3 วัน (เกณฑ์ 3 วัน)',
      }),
      undefined,
    );
    expect(notificationsService.notifyCaseCreated).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 88, schoolId: 10010002 }),
    );
    expect(riskProfileService.enqueueStudents).toHaveBeenCalledWith(
      ['11111111-1111-4111-8111-111111111111'],
      'subject-risk-monitor',
    );
  });

  it('adds a review note to an existing attendance-risk case and escalates only upward', async () => {
    automationRepository.listSubjectRiskCandidates.mockResolvedValue([
      buildRiskCandidate({
        signal_code: 'LOW_ATTENDANCE_PERCENT',
        metric_value: 79,
        threshold_value: 80,
      }),
    ]);
    automationRepository.findActiveAttendanceRiskCaseByStudent.mockResolvedValue({
      id: 55,
      risk_tier: 'MEDIUM',
      reason_flagged: 'โดดคาบ: มาเรียนบางคาบแต่ขาดบางคาบ 3 วัน (เกณฑ์ 3 วัน)',
    });

    await service.checkSubjectRiskSignals();

    expect(automationRepository.createAutomatedCase).not.toHaveBeenCalled();
    expect(automationRepository.insertSystemCaseReviewNote).toHaveBeenCalledWith(
      55,
      'เวลาเรียนต่ำกว่าเกณฑ์: มาเรียน 79% (ต่ำกว่า 80%)',
      undefined,
    );
    expect(automationRepository.escalateCaseRiskTier).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 55, riskTier: 'HIGH' }),
      undefined,
    );
    expect(notificationsService.notifyCaseRiskEscalated).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 55, fromTier: 'MEDIUM', toTier: 'HIGH' }),
    );
  });

  it('sends a watch notification for subject lateness without creating a case', async () => {
    automationRepository.listSubjectLateWatchCandidates.mockResolvedValue([buildLateWatch()]);

    await service.checkSubjectRiskSignals();

    expect(automationRepository.createAutomatedCase).not.toHaveBeenCalled();
    expect(notificationsService.notifyStudentRiskWatch).toHaveBeenCalledWith({
      studentName: 'สมหญิง ตั้งใจ',
      schoolId: 10010002,
      gradeLevel: '6',
      roomId: '1',
      reason: 'มาสาย 5 ครั้งใน 30 วัน (เกณฑ์ 5 ครั้ง)',
      refId: '22222222-2222-4222-8222-222222222222:subject-late:30:5',
    });
  });
});

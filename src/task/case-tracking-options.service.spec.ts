import { BadRequestException } from '@nestjs/common';
import { CaseTrackingOptionsService } from './case-tracking-options.service';
import { TaskRepository } from './task.repository';

describe('CaseTrackingOptionsService', () => {
  const repository = {
    listCaseReviewActions: jest.fn(),
    listCaseFollowUpDecisions: jest.fn(),
    listCaseResolutionOutcomes: jest.fn(),
    listHomeVisitExceptionOptions: jest.fn(),
    listFollowUpProblemCategoryOptions: jest.fn(),
    listParentalStatusOptions: jest.fn(),
    listGuardianTypeOptions: jest.fn(),
    listResidenceEnvironmentOptions: jest.fn(),
    findCaseReviewAction: jest.fn(),
    findCaseFollowUpDecision: jest.fn(),
    findCaseResolutionOutcome: jest.fn(),
    findHomeVisitExceptionOption: jest.fn(),
    findFollowUpProblemCategoryOption: jest.fn(),
    findParentalStatusOption: jest.fn(),
    findGuardianTypeOption: jest.fn(),
    findResidenceEnvironmentOptions: jest.fn(),
    listAssistanceMeasures: jest.fn(),
    findAssistanceMeasures: jest.fn(),
    listTaskExecutionOutcomes: jest.fn(),
    findTaskExecutionOutcome: jest.fn(),
    listNonFollowUpReasons: jest.fn(),
    findNonFollowUpReason: jest.fn(),
    listAbsenceReasons: jest.fn(),
    findAbsenceReason: jest.fn(),
    listDisadvantageTypes: jest.fn(),
    findDisadvantageTypes: jest.fn(),
    listDisabilityTypes: jest.fn(),
    findDisabilityTypes: jest.fn(),
    listContactChannelOptions: jest.fn(),
    findContactChannelOption: jest.fn(),
  };
  const service = new CaseTrackingOptionsService(repository as unknown as TaskRepository);

  beforeEach(() => jest.clearAllMocks());

  it('returns active catalog values as the shared UI contract', async () => {
    repository.listCaseReviewActions.mockResolvedValue([
      {
        code: 'REFER_AGENCY',
        label_th: 'ส่งต่อหน่วยงาน',
        target_case_status_code: 'RESOLVED',
        completion_outcome_code: 'REFERRED_AGENCY',
        requires_resolution_outcome: false,
        required_permission_code: 'dashboard',
      },
      {
        code: 'CLOSE',
        label_th: 'ปิดเคส',
        target_case_status_code: 'RESOLVED',
        completion_outcome_code: 'CLOSED',
        requires_resolution_outcome: false,
        required_permission_code: 'dashboard',
      },
      {
        code: 'ASSIST',
        label_th: 'ให้ความช่วยเหลือ',
        target_case_status_code: 'OPEN',
        completion_outcome_code: null,
        requires_resolution_outcome: false,
        required_permission_code: 'dashboard',
        available_phase_code: 'FOLLOW_UP',
        target_workflow_phase_code: 'ASSISTANCE',
      },
    ]);
    repository.listCaseFollowUpDecisions.mockResolvedValue([
      {
        code: 'REQUEST_REVIEW',
        label_th: 'ส่งให้ตรวจผล',
        target_case_status_code: 'PENDING_REVIEW',
        requires_resolution_outcome: false,
      },
    ]);
    repository.listCaseResolutionOutcomes.mockResolvedValue([
      { code: 'RETURNED_TO_SCHOOL', label_th: 'กลับมาเรียนแล้ว' },
    ]);
    repository.listHomeVisitExceptionOptions.mockResolvedValue([
      {
        code: 'ADDRESS_CHANGED',
        label_th: 'เปลี่ยนที่อยู่',
        requires_updated_address: true,
      },
    ]);
    repository.listFollowUpProblemCategoryOptions.mockResolvedValue([
      {
        code: 'HEALTH',
        label_th: 'ปัญหาด้านสุขภาพ',
        guidance_th: 'เช่น เจ็บป่วย, ได้รับบาดเจ็บ',
      },
    ]);
    repository.listParentalStatusOptions.mockResolvedValue([
      { code: 'LIVING_TOGETHER', label_th: 'อยู่ด้วยกัน' },
    ]);
    repository.listGuardianTypeOptions.mockResolvedValue([
      { code: 'OTHER', label_th: 'อื่น ๆ (ระบุในช่อง)', requires_detail: true },
    ]);
    repository.listResidenceEnvironmentOptions.mockResolvedValue([
      {
        code: 'NORMAL',
        label_th: 'ปกติ / ไม่มีปัจจัยเสี่ยง',
        is_exclusive: true,
        requires_detail: false,
      },
    ]);
    repository.listAssistanceMeasures.mockResolvedValue([
      { code: 'SCHOLARSHIP', label_th: 'ให้ทุนการศึกษา', requires_detail: false },
      { code: 'OTHER', label_th: 'อื่น ๆ (ระบุในช่อง)', requires_detail: true },
    ]);
    repository.listTaskExecutionOutcomes.mockResolvedValue([
      { code: 'SUCCEEDED', label_th: 'ช่วยเหลือสำเร็จ', visit_label_th: 'พบนักเรียน' },
      { code: 'NOT_SUCCEEDED', label_th: 'ยังช่วยเหลือไม่สำเร็จ', visit_label_th: 'ไม่พบนักเรียน' },
    ]);
    repository.listNonFollowUpReasons.mockResolvedValue([
      { code: 'UNREACHABLE', label_th: 'ติดต่อไม่ได้' },
    ]);
    repository.listAbsenceReasons.mockResolvedValue([
      {
        code: 'MINOR_ILLNESS',
        label_th: 'ป่วยไม่รุนแรง',
        category_code: 'PERSONAL_FAMILY',
        category_label_th: 'สาเหตุส่วนตัว / ครอบครัว',
      },
    ]);
    repository.listDisadvantageTypes.mockResolvedValue([
      { code: 'POVERTY', label_th: 'เด็กยากจน' },
    ]);
    repository.listDisabilityTypes.mockResolvedValue([
      { code: 'VISUAL', label_th: 'ความพิการทางการมองเห็น' },
    ]);
    repository.listContactChannelOptions.mockResolvedValue([
      { code: 'IN_PERSON', label_th: 'พบด้วยตนเอง' },
    ]);

    await expect(service.getOptions()).resolves.toEqual({
      reviewActions: [
        {
          code: 'REFER_AGENCY',
          completionOutcomeCode: 'REFERRED_AGENCY',
          label: 'ส่งต่อหน่วยงาน',
          targetStatus: 'RESOLVED',
          requiresResolutionOutcome: false,
          requiredPermission: 'dashboard',
          availablePhaseCode: null,
          targetWorkflowPhaseCode: null,
        },
        {
          code: 'CLOSE',
          completionOutcomeCode: 'CLOSED',
          label: 'ปิดเคส',
          targetStatus: 'RESOLVED',
          requiresResolutionOutcome: false,
          requiredPermission: 'dashboard',
          availablePhaseCode: null,
          targetWorkflowPhaseCode: null,
        },
        {
          code: 'ASSIST',
          completionOutcomeCode: null,
          label: 'ให้ความช่วยเหลือ',
          targetStatus: 'OPEN',
          requiresResolutionOutcome: false,
          requiredPermission: 'dashboard',
          availablePhaseCode: 'FOLLOW_UP',
          targetWorkflowPhaseCode: 'ASSISTANCE',
        },
      ],
      followUpDecisions: [
        {
          code: 'REQUEST_REVIEW',
          completionOutcomeCode: null,
          label: 'ส่งให้ตรวจผล',
          targetStatus: 'PENDING_REVIEW',
          requiresResolutionOutcome: false,
          availablePhaseCode: null,
          targetWorkflowPhaseCode: null,
        },
      ],
      resolutionOutcomes: [{ code: 'RETURNED_TO_SCHOOL', label: 'กลับมาเรียนแล้ว' }],
      homeVisitExceptions: [
        {
          code: 'ADDRESS_CHANGED',
          label: 'เปลี่ยนที่อยู่',
          requiresUpdatedAddress: true,
        },
      ],
      followUpProblemCategories: [
        {
          code: 'HEALTH',
          label: 'ปัญหาด้านสุขภาพ',
          guidance: 'เช่น เจ็บป่วย, ได้รับบาดเจ็บ',
        },
      ],
      parentalStatuses: [{ code: 'LIVING_TOGETHER', label: 'อยู่ด้วยกัน' }],
      guardianTypes: [{ code: 'OTHER', label: 'อื่น ๆ (ระบุในช่อง)', requiresDetail: true }],
      residenceEnvironments: [
        {
          code: 'NORMAL',
          label: 'ปกติ / ไม่มีปัจจัยเสี่ยง',
          isExclusive: true,
          requiresDetail: false,
        },
      ],
      assistanceMeasures: [
        { code: 'SCHOLARSHIP', label: 'ให้ทุนการศึกษา', requiresDetail: false },
        { code: 'OTHER', label: 'อื่น ๆ (ระบุในช่อง)', requiresDetail: true },
      ],
      executionOutcomes: [
        { code: 'SUCCEEDED', label: 'ช่วยเหลือสำเร็จ', visitLabel: 'พบนักเรียน' },
        {
          code: 'NOT_SUCCEEDED',
          label: 'ยังช่วยเหลือไม่สำเร็จ',
          visitLabel: 'ไม่พบนักเรียน',
        },
      ],
      nonFollowUpReasons: [{ code: 'UNREACHABLE', label: 'ติดต่อไม่ได้' }],
      absenceReasons: [
        {
          code: 'MINOR_ILLNESS',
          label: 'ป่วยไม่รุนแรง',
          categoryCode: 'PERSONAL_FAMILY',
          categoryLabel: 'สาเหตุส่วนตัว / ครอบครัว',
        },
      ],
      disadvantageTypes: [{ code: 'POVERTY', label: 'เด็กยากจน' }],
      disabilityTypes: [{ code: 'VISUAL', label: 'ความพิการทางการมองเห็น' }],
      contactChannels: [{ code: 'IN_PERSON', label: 'พบด้วยตนเอง' }],
    });
  });

  it('rejects an assistance assignment whose OTHER measure has no detail', async () => {
    repository.findAssistanceMeasures.mockResolvedValue([
      { code: 'OTHER', label_th: 'อื่น ๆ (ระบุในช่อง)', requires_detail: true },
    ]);

    await expect(service.getAssistanceMeasures(['OTHER'], null)).rejects.toThrow(
      'กรุณาระบุรายละเอียดมาตรการการช่วยเหลือ',
    );
  });

  it('rejects an assistance assignment with no measure picked', async () => {
    await expect(service.getAssistanceMeasures([], null)).rejects.toThrow(
      'กรุณาเลือกมาตรการการช่วยเหลืออย่างน้อยหนึ่งอย่าง',
    );
  });

  it('rejects an exclusive residence environment mixed with risk factors', async () => {
    repository.findResidenceEnvironmentOptions.mockResolvedValue([
      {
        code: 'NORMAL',
        label_th: 'ปกติ / ไม่มีปัจจัยเสี่ยง',
        is_exclusive: true,
        requires_detail: false,
      },
      {
        code: 'AREA_CRIME',
        label_th: 'มีปัญหาอาชญากรรมในพื้นที่',
        is_exclusive: false,
        requires_detail: false,
      },
    ]);

    await expect(
      service.getResidenceEnvironments(['NORMAL', 'AREA_CRIME'], null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires the free-text description when an option is flagged for it', async () => {
    repository.findResidenceEnvironmentOptions.mockResolvedValue([
      {
        code: 'OTHER',
        label_th: 'อื่น ๆ (ระบุในรายละเอียด)',
        is_exclusive: false,
        requires_detail: true,
      },
    ]);

    await expect(service.getResidenceEnvironments(['OTHER'], null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.getResidenceEnvironments(['OTHER'], 'ติดถนนใหญ่ รถวิ่งเร็ว'),
    ).resolves.toEqual([
      {
        code: 'OTHER',
        label: 'อื่น ๆ (ระบุในรายละเอียด)',
        isExclusive: false,
        requiresDetail: true,
      },
    ]);
  });

  it('rejects values that are not present in the active catalogs', async () => {
    repository.findCaseFollowUpDecision.mockResolvedValue(null);
    await expect(service.getFollowUpDecision('RETIRED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resolves the contact channel from the catalog instead of an inline list', async () => {
    repository.findContactChannelOption.mockResolvedValue({
      code: 'PHONE',
      label_th: 'โทรศัพท์',
    });
    await expect(service.getContactChannel('PHONE')).resolves.toBe('PHONE');
    await expect(service.getContactChannel(null)).resolves.toBeNull();
    repository.findContactChannelOption.mockResolvedValue(null);
    await expect(service.getContactChannel('RETIRED')).rejects.toBeInstanceOf(BadRequestException);
  });
});

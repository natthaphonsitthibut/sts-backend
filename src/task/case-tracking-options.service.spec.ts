import { BadRequestException } from '@nestjs/common';
import { CaseTrackingOptionsService } from './case-tracking-options.service';
import { TaskRepository } from './task.repository';

describe('CaseTrackingOptionsService', () => {
  const repository = {
    listCaseReviewActions: jest.fn(),
    listCaseFollowUpDecisions: jest.fn(),
    listCaseResolutionOutcomes: jest.fn(),
    listHomeVisitExceptionOptions: jest.fn(),
    listHomeVisitAssessmentOptions: jest.fn(),
    findCaseReviewAction: jest.fn(),
    findCaseFollowUpDecision: jest.fn(),
    findCaseResolutionOutcome: jest.fn(),
    findHomeVisitExceptionOption: jest.fn(),
    findHomeVisitAssessmentOption: jest.fn(),
  };
  const service = new CaseTrackingOptionsService(repository as unknown as TaskRepository);

  beforeEach(() => jest.clearAllMocks());

  it('returns active catalog values as the shared UI contract', async () => {
    repository.listCaseReviewActions.mockResolvedValue([
      {
        code: 'CONTINUE',
        label_th: 'ติดตามต่อ',
        target_case_status_code: 'IN_PROGRESS',
        requires_resolution_outcome: false,
        required_permission_code: 'review-cases',
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
    repository.listHomeVisitAssessmentOptions.mockResolvedValue([
      { code: 'CONTINUE_FOLLOW_UP', label_th: 'ควรติดตามต่อ' },
    ]);

    await expect(service.getOptions()).resolves.toEqual({
      reviewActions: [
        {
          code: 'CONTINUE',
          label: 'ติดตามต่อ',
          targetStatus: 'IN_PROGRESS',
          requiresResolutionOutcome: false,
          requiredPermission: 'review-cases',
        },
      ],
      followUpDecisions: [
        {
          code: 'REQUEST_REVIEW',
          label: 'ส่งให้ตรวจผล',
          targetStatus: 'PENDING_REVIEW',
          requiresResolutionOutcome: false,
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
      homeVisitAssessments: [{ code: 'CONTINUE_FOLLOW_UP', label: 'ควรติดตามต่อ' }],
    });
  });

  it('rejects values that are not present in the active catalogs', async () => {
    repository.findCaseFollowUpDecision.mockResolvedValue(null);
    await expect(service.getFollowUpDecision('RETIRED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { ObservationReviewsService } from './observation-reviews.service';
import type { FollowUpRequestRow, RiskReviewRow } from './observation-reviews.types';

const STUDENT_UUID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const ENROLLMENT = {
  student_uuid: STUDENT_UUID,
  school_id: 101,
  school_term_id: '55',
  classroom_id: '77',
};
const MANAGER: AuthenticatedRequestUser = {
  id: 5,
  username: 'director',
  roles: ['DIRECTOR'],
  permissions: ['manage-student-observations'],
  data_scope: { school_ids: [101] },
};

const RISK_ROW: RiskReviewRow = {
  id: REVIEW_ID,
  student_uuid: STUDENT_UUID,
  school_id: 101,
  calculated_attendance_risk: 'HIGH',
  teacher_concern_signal: 'CONCERN',
  human_risk_decision: 'WATCH',
  decision_reason: 'ต้องติดตามข้อมูลเพิ่ม',
  decided_by: 5,
  decided_by_username: 'director',
  decided_at: '2026-07-15T01:00:00.000Z',
  revision_number: 1,
  sources: [{ observationId: 9, revision: 2 }],
};

const FOLLOW_UP_ROW: FollowUpRequestRow = {
  id: REQUEST_ID,
  student_uuid: STUDENT_UUID,
  school_id: 101,
  follow_up_request_type: 'HOME_VISIT_CONSIDERATION',
  status: 'PENDING_REVIEW',
  urgency: 'URGENT',
  request_reason: 'ขอให้โรงเรียนพิจารณาติดตาม',
  supplemental_note: null,
  requested_by: 8,
  requested_by_username: 'teacher',
  requester_teacher_membership_id: 12,
  source_assignment_id: 31,
  review_decision: null,
  review_reason: null,
  reviewed_by: null,
  reviewed_by_username: null,
  reviewed_at: null,
  assigned_task_id: null,
  assigned_by: null,
  assigned_by_username: null,
  assigned_at: null,
  revision_number: 2,
  created_at: '2026-07-15T01:00:00.000Z',
  updated_at: '2026-07-15T02:00:00.000Z',
  sources: [{ observationId: 9, revision: 2 }],
};

describe('ObservationReviewsService', () => {
  function buildService() {
    const queryRunner = {};
    const repository = {
      withTransaction: jest.fn(async (operation: (runner: object) => Promise<unknown>) => {
        return await operation(queryRunner);
      }),
      lockEnrollment: jest.fn().mockResolvedValue(ENROLLMENT),
      findEnrollment: jest.fn().mockResolvedValue(ENROLLMENT),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      findLatestRiskReview: jest.fn().mockResolvedValue(null),
      validateObservationSources: jest
        .fn()
        .mockResolvedValue([
          { observation_id: 9, observation_revision: 2, concern_level: 'CONCERN' },
        ]),
      findCalculatedAttendanceRisk: jest.fn().mockResolvedValue('HIGH'),
      insertRiskReview: jest.fn().mockResolvedValue(RISK_ROW),
      findActiveAssignment: jest.fn().mockResolvedValue({
        assignment_id: 31,
        teacher_membership_id: 12,
        teacher_user_id: 8,
        school_id: 101,
        school_term_id: 55,
        classroom_id: 77,
      }),
      findPendingFollowUpForUpdate: jest.fn().mockResolvedValue(null),
      createFollowUpRequest: jest.fn().mockResolvedValue(REQUEST_ID),
      mergePendingFollowUp: jest.fn().mockResolvedValue(undefined),
      addFollowUpSources: jest.fn().mockResolvedValue(undefined),
      findFollowUpById: jest.fn().mockResolvedValue(FOLLOW_UP_ROW),
      listFollowUps: jest.fn().mockResolvedValue([FOLLOW_UP_ROW]),
      reviewFollowUp: jest.fn().mockResolvedValue(true),
    };
    const auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    const teacherAccess = { withActiveGrantContext: jest.fn() };
    return {
      service: new ObservationReviewsService(
        repository as never,
        auditLog as never,
        teacherAccess as never,
      ),
      repository,
      auditLog,
      teacherAccess,
    };
  }

  it('records separate calculated, teacher, and human signals with optimistic revision', async () => {
    const { service, repository, auditLog } = buildService();
    const result = await service.createRiskReview(
      STUDENT_UUID,
      {
        expectedRevision: 0,
        humanRiskDecision: 'WATCH',
        decisionReason: 'ต้องติดตามข้อมูลเพิ่ม',
        sourceObservations: [{ observationId: 9, revision: 2 }],
      },
      MANAGER,
    );

    expect(repository.insertRiskReview).toHaveBeenCalledWith(
      expect.objectContaining({
        calculatedAttendanceRisk: 'HIGH',
        teacherConcernSignal: 'CONCERN',
        humanRiskDecision: 'WATCH',
        revision: 1,
      }),
      expect.anything(),
    );
    expect(result.data).toMatchObject({
      calculatedAttendanceRisk: 'HIGH',
      teacherConcernSignal: 'CONCERN',
      humanRiskDecision: 'WATCH',
      revision: 1,
    });
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_OBSERVATION_UPDATE' }),
      expect.anything(),
    );
  });

  it('rejects a stale human decision revision', async () => {
    const { service, repository } = buildService();
    repository.findLatestRiskReview.mockResolvedValue({ ...RISK_ROW, revision_number: 3 });
    await expect(
      service.createRiskReview(
        STUDENT_UUID,
        {
          expectedRevision: 2,
          humanRiskDecision: 'NO_ACTION',
          decisionReason: 'ยังไม่ต้องดำเนินการ',
          sourceObservations: [{ observationId: 9, revision: 2 }],
        },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.insertRiskReview).not.toHaveBeenCalled();
  });

  it('merges evidence into the existing pending follow-up instead of creating a duplicate', async () => {
    const { service, repository } = buildService();
    repository.findPendingFollowUpForUpdate.mockResolvedValue(FOLLOW_UP_ROW);
    const teacher: AuthenticatedRequestUser = {
      id: 8,
      username: 'teacher',
      roles: ['TEACHER'],
      permissions: ['student-observations'],
    };

    const result = await service.createFollowUp(
      STUDENT_UUID,
      {
        assignmentId: 31,
        urgency: 'URGENT',
        reason: 'พบหลักฐานเพิ่ม',
        sourceObservations: [{ observationId: 9, revision: 2 }],
      },
      teacher,
    );

    expect(repository.createFollowUpRequest).not.toHaveBeenCalled();
    expect(repository.mergePendingFollowUp).toHaveBeenCalledWith(
      REQUEST_ID,
      'URGENT',
      expect.anything(),
    );
    expect(repository.addFollowUpSources).toHaveBeenCalled();
    expect(result.meta).toEqual({ created: false });
  });

  it('requires the logged teacher to own an active assignment', async () => {
    const { service, repository } = buildService();
    repository.findActiveAssignment.mockResolvedValue({
      assignment_id: 31,
      teacher_membership_id: 12,
      teacher_user_id: 99,
      school_id: 101,
      school_term_id: 55,
      classroom_id: 77,
    });
    await expect(
      service.createFollowUp(
        STUDENT_UUID,
        {
          assignmentId: 31,
          urgency: 'NORMAL',
          reason: 'ขอติดตาม',
          sourceObservations: [{ observationId: 9, revision: 2 }],
        },
        {
          id: 8,
          username: 'teacher',
          roles: ['TEACHER'],
          permissions: ['student-observations'],
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('binds teacher-link requests to capability, assignment, and student roster', async () => {
    const { service, teacherAccess } = buildService();
    teacherAccess.withActiveGrantContext.mockImplementation(
      async (
        _token: string,
        _options: unknown,
        operation: (grant: object, queryRunner: object) => Promise<unknown>,
      ) =>
        await operation(
          {
            grantId: '44444444-4444-4444-8444-444444444444',
            teacherMembershipId: 12,
            teacherUserId: 8,
            teacherUsername: 'teacher',
            schoolId: 101,
            schoolName: 'School',
            schoolTermId: 55,
            academicYear: 2569,
            semester: 1,
            assignmentId: 31,
            classroomId: 77,
            subjectId: 3,
            capabilities: ['TEACHER_OBSERVATION'],
          },
          {},
        ),
    );

    await service.createFollowUpWithTeacherAccess('TOKEN_PLACEHOLDER_32_CHARACTERS', STUDENT_UUID, {
      assignmentId: 31,
      urgency: 'NORMAL',
      reason: 'ขอให้พิจารณาติดตาม',
      sourceObservations: [{ observationId: 9, revision: 2 }],
    });

    expect(teacherAccess.withActiveGrantContext).toHaveBeenCalledWith(
      'TOKEN_PLACEHOLDER_32_CHARACTERS',
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId: 31,
        studentUuid: STUDENT_UUID,
        operation: 'CREATE_STUDENT_FOLLOW_UP_REQUEST',
      },
      expect.any(Function),
    );
  });

  it('records review intent without creating a case, visit, or risk mutation', async () => {
    const { service, repository } = buildService();
    repository.findFollowUpById.mockResolvedValueOnce(FOLLOW_UP_ROW).mockResolvedValueOnce({
      ...FOLLOW_UP_ROW,
      status: 'APPROVE_AND_ASSIGN',
      review_decision: 'APPROVE_AND_ASSIGN',
      review_reason: 'อนุมัติให้ส่งต่อขั้นตอนมอบหมาย',
      reviewed_by: 5,
      reviewed_by_username: 'director',
      reviewed_at: '2026-07-15T03:00:00.000Z',
      revision_number: 3,
    });

    const result = await service.reviewFollowUp(
      STUDENT_UUID,
      REQUEST_ID,
      {
        expectedRevision: 2,
        decision: 'APPROVE_AND_ASSIGN',
        reason: 'อนุมัติให้ส่งต่อขั้นตอนมอบหมาย',
      },
      MANAGER,
    );

    expect(repository.reviewFollowUp).toHaveBeenCalledTimes(1);
    expect(result.data.status).toBe('APPROVE_AND_ASSIGN');
    expect(Object.keys(repository)).not.toEqual(
      expect.arrayContaining(['createCase', 'createVisit', 'updateRiskProfile']),
    );
  });

  it('denies executive access to raw per-student review data', async () => {
    const { service } = buildService();
    await expect(
      service.getLatestRiskReview(STUDENT_UUID, {
        id: 20,
        username: 'executive',
        roles: ['EXECUTIVE'],
        permissions: ['manage-student-observations'],
        data_scope: { global: true },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

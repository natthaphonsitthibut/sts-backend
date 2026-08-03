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
  status_label_th: 'รอพิจารณา',
  status_badge_variant: 'warning',
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
  opened_case_id: null,
  opened_case_status: null,
  student_first_name: 'เด็ก',
  student_last_name: 'ทดสอบ',
  student_name: 'เด็ก ทดสอบ',
  student_school: 'โรงเรียนทดสอบ',
  student_address: null,
  address_line: null,
  address_province: null,
  address_district: null,
  address_sub_district: null,
  postal_code: null,
  student_lat: null,
  student_lng: null,
  grade_label: 'ป.1',
  room_no: 1,
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
      findActiveAssignmentForTeacher: jest.fn().mockResolvedValue({
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
      listTeacherObservationReports: jest.fn().mockResolvedValue([]),
      listTeacherWatchlist: jest.fn().mockResolvedValue([]),
      listStudentClassroomComments: jest.fn().mockResolvedValue([]),
      listHomeVisitRequests: jest.fn().mockResolvedValue([]),
    };
    const auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
      recordAtomic: jest.fn().mockResolvedValue(undefined),
    };
    const teacherAccess = { withActiveGrantContext: jest.fn() };
    const taskRepository = { createCase: jest.fn().mockResolvedValue(123) };
    return {
      service: new ObservationReviewsService(
        repository as never,
        auditLog as never,
        teacherAccess as never,
        taskRepository as never,
      ),
      repository,
      auditLog,
      teacherAccess,
      taskRepository,
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

  it('records an attendance-only review when no teacher observation exists', async () => {
    const { service, repository } = buildService();
    repository.validateObservationSources.mockResolvedValue([]);
    repository.insertRiskReview.mockResolvedValue({
      ...RISK_ROW,
      teacher_concern_signal: 'NONE',
      sources: [],
    });

    const result = await service.createRiskReview(
      STUDENT_UUID,
      {
        expectedRevision: 0,
        humanRiskDecision: 'WATCH',
        decisionReason: 'ติดตามจากข้อมูลการมาเรียนก่อน',
        sourceObservations: [],
      },
      MANAGER,
    );

    expect(repository.insertRiskReview).toHaveBeenCalledWith(
      expect.objectContaining({
        calculatedAttendanceRisk: 'HIGH',
        teacherConcernSignal: 'NONE',
        sources: [],
      }),
      expect.anything(),
    );
    expect(result.data.teacherConcernSignal).toBe('NONE');
    expect(result.data.sourceObservations).toEqual([]);
  });

  it('returns current attendance risk before the first human review', async () => {
    const { service, repository } = buildService();

    const result = await service.getLatestRiskReview(STUDENT_UUID, MANAGER);

    expect(result).toEqual({
      data: null,
      meta: { currentCalculatedAttendanceRisk: 'HIGH' },
    });
    expect(repository.findCalculatedAttendanceRisk).toHaveBeenCalledWith(STUDENT_UUID);
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

  it('allows a teacher to request a home visit without an observation', async () => {
    const { service, repository } = buildService();
    const result = await service.createFollowUp(
      STUDENT_UUID,
      {
        urgency: 'NORMAL',
        reason: 'ได้รับข้อมูลจากผู้ปกครองและควรลงพื้นที่',
        sourceObservations: [],
      },
      {
        id: 8,
        username: 'teacher',
        roles: ['TEACHER'],
        permissions: ['student-observations'],
      },
    );

    expect(repository.findActiveAssignmentForTeacher).toHaveBeenCalledWith(
      8,
      STUDENT_UUID,
      expect.any(String),
      expect.anything(),
    );
    expect(repository.validateObservationSources).not.toHaveBeenCalled();
    expect(repository.addFollowUpSources).toHaveBeenCalledWith(
      REQUEST_ID,
      [],
      8,
      null,
      expect.anything(),
    );
    expect(result.meta).toEqual({ created: true });
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

  it('opens a case immediately when the reviewer approves', async () => {
    const { service, repository, taskRepository } = buildService();
    repository.findFollowUpById.mockResolvedValueOnce(FOLLOW_UP_ROW).mockResolvedValueOnce({
      ...FOLLOW_UP_ROW,
      status: 'APPROVED',
      status_label_th: 'อนุมัติแล้ว',
      status_badge_variant: 'success',
      review_decision: 'APPROVED',
      review_reason: 'อนุมัติให้เปิดเคส',
      reviewed_by: 5,
      reviewed_by_username: 'director',
      reviewed_at: '2026-07-15T03:00:00.000Z',
      opened_case_id: 123,
      opened_case_status: 'OPEN',
      revision_number: 3,
    });

    const result = await service.reviewFollowUp(
      STUDENT_UUID,
      REQUEST_ID,
      {
        expectedRevision: 2,
        decision: 'APPROVED',
        reason: 'อนุมัติให้เปิดเคส',
      },
      MANAGER,
    );

    expect(taskRepository.createCase).toHaveBeenCalledTimes(1);
    expect(repository.reviewFollowUp).toHaveBeenCalledWith(
      REQUEST_ID,
      2,
      'APPROVED',
      'อนุมัติให้เปิดเคส',
      5,
      123,
      expect.anything(),
    );
    expect(result.data).toMatchObject({
      status: 'APPROVED',
      openedCase: { caseId: 123, status: 'OPEN' },
    });
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

  it('lists the teacher report queue with server-enforced actor scope', async () => {
    const { service, repository } = buildService();
    await expect(
      service.listTeacherObservationReports(
        { page: 1, limit: 20, sortBy: 'studentName', sortDirection: 'asc' },
        MANAGER,
      ),
    ).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, totalCount: 0, totalPages: 0 },
    });
    expect(repository.listTeacherObservationReports).toHaveBeenCalledWith(
      { school_ids: [101] },
      expect.objectContaining({
        page: 1,
        limit: 20,
        sortBy: 'studentName',
        sortDirection: 'asc',
      }),
    );
  });

  it('lists the classroom-comment watchlist once per student and audits only aggregate metadata', async () => {
    const { service, repository, auditLog } = buildService();
    repository.listTeacherWatchlist.mockResolvedValueOnce([
      {
        student_uuid: STUDENT_UUID,
        student_name: 'เด็ก ทดสอบ',
        school_id: 101,
        school_name: 'โรงเรียนทดสอบ',
        grade_label: 'ป.1',
        room_no: 1,
        latest_comment_id: '9',
        latest_comment: 'ต้องเฝ้าระวัง',
        latest_author_display_name: 'ครู ทดสอบ',
        latest_commented_at: '2026-07-15T01:00:00.000Z',
        comment_count: 3,
        total_count: 1,
      },
    ]);

    const result = await service.listTeacherWatchlist({ page: 1, limit: 20 }, MANAGER);

    expect(repository.listTeacherWatchlist).toHaveBeenCalledWith(
      { school_ids: [101] },
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(result.data[0]).toMatchObject({
      studentTermId: STUDENT_UUID,
      latestComment: 'ต้องเฝ้าระวัง',
      commentCount: 3,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'classroom_student_comment_watchlist',
        metadata: {
          resultCount: 1,
          operation: 'CLASSROOM_STUDENT_COMMENT_WATCHLIST_VIEW',
        },
      }),
    );
  });

  it('returns the latest classroom comments for a student from the same scoped source', async () => {
    const { service, repository, auditLog } = buildService();
    repository.listStudentClassroomComments.mockResolvedValueOnce([
      {
        id: '91',
        student_uuid: STUDENT_UUID,
        comment: 'ควรติดตามการส่งงาน',
        author_display_name: 'ครู ทดสอบ',
        commented_at: '2026-08-03T01:00:00.000Z',
        total_count: 4,
      },
    ]);

    const result = await service.listStudentClassroomComments(STUDENT_UUID, MANAGER);

    expect(repository.listStudentClassroomComments).toHaveBeenCalledWith(
      { school_ids: [101] },
      STUDENT_UUID,
      3,
    );
    expect(result).toEqual({
      data: [
        {
          id: '91',
          studentTermId: STUDENT_UUID,
          comment: 'ควรติดตามการส่งงาน',
          authorDisplayName: 'ครู ทดสอบ',
          commentedAt: '2026-08-03T01:00:00.000Z',
        },
      ],
      meta: { totalCount: 4 },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'classroom_student_comments',
        targetId: STUDENT_UUID,
        metadata: {
          resultCount: 1,
          totalCount: 4,
          operation: 'STUDENT_CLASSROOM_COMMENTS_VIEW',
        },
      }),
    );
  });

  it('lists and protects the home-visit request queue with the same actor scope', async () => {
    const { service, repository } = buildService();
    repository.listHomeVisitRequests.mockResolvedValueOnce([FOLLOW_UP_ROW]);

    const result = await service.listHomeVisitRequests(
      { page: 1, limit: 20, sortBy: 'urgency', sortDirection: 'desc' },
      MANAGER,
    );
    expect(repository.listHomeVisitRequests).toHaveBeenCalledWith(
      { school_ids: [101] },
      expect.objectContaining({
        page: 1,
        limit: 20,
        sortBy: 'urgency',
        sortDirection: 'desc',
      }),
    );
    expect(result.data[0]).toMatchObject({
      id: REQUEST_ID,
      student: { displayName: 'เด็ก ทดสอบ', schoolName: 'โรงเรียนทดสอบ' },
    });

    repository.listHomeVisitRequests.mockResolvedValueOnce([]);
    await expect(service.getHomeVisitRequest(REQUEST_ID, MANAGER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { TeacherCommentsService } from './teacher-comments.service';

const STUDENT_UUID = '11111111-1111-4111-8111-111111111111';
const MANAGER: AuthenticatedRequestUser = {
  id: 5,
  username: 'director',
  roles: ['DIRECTOR'],
  permissions: ['students'],
  data_scope: { school_ids: [101] },
};

function buildService() {
  const repository = {
    listStudentClassroomComments: jest.fn(),
    listClassroomComments: jest.fn(),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new TeacherCommentsService(repository as never, auditLog as never);
  return { auditLog, repository, service };
}

describe('TeacherCommentsService', () => {
  it('denies executive access to raw per-student comments', async () => {
    const { service } = buildService();
    await expect(
      service.listStudentComments(STUDENT_UUID, {
        id: 20,
        username: 'executive',
        roles: ['EXECUTIVE'],
        permissions: ['students'],
        data_scope: { global: true },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an own-only scope that cannot read school-wide comments', async () => {
    const { service } = buildService();
    await expect(
      service.listComments(
        { page: 1, limit: 20 },
        { ...MANAGER, data_scope: { school_ids: [101], own_only: true } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the latest classroom comments for a student from the scoped source', async () => {
    const { auditLog, repository, service } = buildService();
    repository.listStudentClassroomComments.mockResolvedValueOnce([
      {
        id: '91',
        student_uuid: STUDENT_UUID,
        problem_category_code: 'ACADEMIC',
        problem_category_label: 'ปัญหาด้านการเรียน',
        problem_category_guidance: 'เช่น หมดไฟ, เรียนไม่ทัน',
        problem_description: 'ควรติดตามการส่งงาน',
        concern_level_code: 'NOTE',
        concern_level_label: 'บันทึกทั่วไป',
        author_display_name: 'ครู ทดสอบ',
        commented_at: '2026-08-03T01:00:00.000Z',
        total_count: 4,
      },
    ]);

    const result = await service.listStudentComments(STUDENT_UUID, MANAGER);

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
          problemCategory: 'ACADEMIC',
          problemCategoryLabel: 'ปัญหาด้านการเรียน',
          problemCategoryGuidance: 'เช่น หมดไฟ, เรียนไม่ทัน',
          problemDescription: 'ควรติดตามการส่งงาน',
          concernLevelCode: 'NOTE',
          concernLevelLabel: 'บันทึกทั่วไป',
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

  it('pages the comment report and names the student classroom', async () => {
    const { repository, service } = buildService();
    repository.listClassroomComments.mockResolvedValueOnce([
      {
        id: '91',
        student_uuid: STUDENT_UUID,
        student_name: 'เด็ก ทดสอบ',
        school_name: 'โรงเรียนทดสอบ',
        grade_label: 'ป.1',
        room_no: '1',
        problem_category_code: 'ACADEMIC',
        problem_category_label: 'ปัญหาด้านการเรียน',
        problem_category_guidance: null,
        problem_description: 'ควรติดตามการส่งงาน',
        concern_level_code: 'WATCH',
        concern_level_label: 'ควรเฝ้าดู',
        author_display_name: 'ครู ทดสอบ',
        commented_at: '2026-08-03T01:00:00.000Z',
        total_count: 1,
      },
    ]);

    const result = await service.listComments({ page: 1, limit: 20 }, MANAGER);

    expect(repository.listClassroomComments).toHaveBeenCalledWith(
      { school_ids: [101] },
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(result.data[0]).toMatchObject({
      studentUuid: STUDENT_UUID,
      studentName: 'เด็ก ทดสอบ',
      concernLevelCode: 'WATCH',
    });
    expect(result.meta).toMatchObject({ totalCount: 1 });
  });
});

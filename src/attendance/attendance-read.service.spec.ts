import { AttendanceReadService } from './attendance-read.service';
import type { AttendanceRepository } from './attendance.repository';

describe('AttendanceReadService', () => {
  it('returns guarded student photo URLs without exposing storage keys', async () => {
    const attendanceRepository = {
      listStudents: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'เด็ก ทดสอบ',
          grade: 'ม.1',
          room: '1',
          school_id: 10010002,
          school_name: 'โรงเรียนทดสอบ',
          student_number: '66000001',
          photo_storage_key: 'student-photos/person/profile.webp',
          photo_updated_at: '2026-08-10T06:30:00.000Z',
          term_absent_days: 4,
          post_case_absent_days: 1,
          absence_reset_after_date: '2026-08-01',
        },
      ]),
    };
    const service = new AttendanceReadService(
      attendanceRepository as unknown as AttendanceRepository,
    );

    const result = await service.getStudents('ม.1', '1', '10010002', {
      school_ids: [10010002],
    });

    expect(result.data[0]).toMatchObject({
      student_number: '66000001',
      term_absent_days: 4,
      post_case_absent_days: 1,
      absence_reset_after_date: '2026-08-01',
      photo_url:
        '/api/students/00000000-0000-4000-8000-000000000001/photo?v=2026-08-10T06%3A30%3A00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('student-photos/person/profile.webp');
  });
});

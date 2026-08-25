import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { StudentsRepository } from './students.repository';
import { StudentGeocodeCacheService } from '../student-geocode/student-geocode-cache.service';
import { FILE_STORAGE_ADAPTER } from '../files/storage/file-storage.types';
import { piiConfig } from '../config/pii.config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('StudentsService', () => {
  let service: StudentsService;
  let studentsRepository: {
    listStudents: jest.Mock;
    getStudentFilterOptions: jest.Mock;
    findStudentById: jest.Mock;
    findCasesByStudentName: jest.Mock;
    findCasesByStudentId: jest.Mock;
    listAttendanceByStudentId: jest.Mock;
    findStudentProfileSummary: jest.Mock;
    listStudentAttendanceCalendar: jest.Mock;
    listStudentCareConsiderations: jest.Mock;
    listStudentSubjectAttendanceByDate: jest.Mock;
    insertPiiAccessEvent: jest.Mock;
    listActiveRevealGroups: jest.Mock;
    updateStudentByUuid: jest.Mock;
    findPersonUuidByStudentUuid: jest.Mock;
    findStudentPersonContact: jest.Mock;
    findStudentAccountByPersonUuid: jest.Mock;
    listGuardiansByPersonUuid: jest.Mock;
    updateStudentPersonContacts: jest.Mock;
    listManagementClassrooms: jest.Mock;
    createStudent: jest.Mock;
  };
  let geocodeCache: { resolve: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        {
          provide: StudentsRepository,
          useValue: {
            listStudents: jest.fn(),
            getStudentFilterOptions: jest.fn(),
            findStudentById: jest.fn(),
            findCasesByStudentName: jest.fn(),
            findCasesByStudentId: jest.fn(),
            listAttendanceByStudentId: jest.fn(),
            findStudentProfileSummary: jest.fn(),
            listStudentAttendanceCalendar: jest.fn(),
            listStudentCareConsiderations: jest.fn().mockResolvedValue([]),
            listStudentSubjectAttendanceByDate: jest.fn(),
            insertPiiAccessEvent: jest.fn(),
            listActiveRevealGroups: jest.fn(),
            updateStudentByUuid: jest.fn(),
            findPersonUuidByStudentUuid: jest.fn(),
            findStudentPersonContact: jest.fn().mockResolvedValue(null),
            findStudentAccountByPersonUuid: jest.fn().mockResolvedValue(null),
            listGuardiansByPersonUuid: jest.fn().mockResolvedValue([]),
            updateStudentPersonContacts: jest.fn(),
            listManagementClassrooms: jest.fn().mockResolvedValue([]),
            createStudent: jest.fn(),
            findPersonPhotoStorageKey: jest.fn().mockResolvedValue(null),
            updatePersonPhotoStorageKey: jest.fn(),
          },
        },
        {
          provide: StudentGeocodeCacheService,
          useValue: {
            resolve: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: FILE_STORAGE_ADAPTER,
          useValue: {
            save: jest.fn(),
            resolve: jest.fn().mockResolvedValue(null),
            delete: jest.fn(),
          },
        },
        {
          provide: piiConfig.KEY,
          useValue: {
            hashPepper: 'test-pepper-at-least-16-chars',
            hashKeyVersion: 1,
            revealTtlSeconds: 900,
          },
        },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
    studentsRepository = module.get(StudentsRepository);
    geocodeCache = module.get(StudentGeocodeCacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a student from an in-scope classroom and returns the persisted row', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    const scope = { school_ids: [10010002] };
    const actor = {
      id: 5,
      username: 'admin',
      roles: ['ADMIN'],
      permissions: ['manage-students'],
    };
    studentsRepository.createStudent.mockResolvedValue({ studentUuid });
    studentsRepository.findStudentById.mockResolvedValue({
      id: studentUuid,
      student_uuid: studentUuid,
      FirstName_Onec: 'สมชาย',
      LastName_Onec: 'ใจดี',
      PersonID_Onec: '1234567890123',
    });
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);
    studentsRepository.findPersonUuidByStudentUuid.mockResolvedValue(
      '10000000-0000-4000-8000-000000000001',
    );

    await expect(
      service.create(
        {
          PersonID_Onec: '1234567890123',
          FirstName_Onec: 'สมชาย',
          LastName_Onec: 'ใจดี',
          classroom_id: 99,
          student_status_code: 10,
        },
        actor,
        scope,
      ),
    ).resolves.toEqual(expect.objectContaining({ id: studentUuid }));
    expect(studentsRepository.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        PersonID_Onec: '1234567890123',
        classroom_id: 99,
        student_status_code: 10,
      }),
      5,
      scope,
    );
  });

  it('passes geo filters to the student list query', async () => {
    studentsRepository.listStudents.mockResolvedValue({ rows: [], totalCount: 0 });

    await service.findAll({
      province: 'กรุงเทพมหานคร',
      district: 'เขตปทุมวัน',
      subDistrict: 'รองเมือง',
      page: 1,
      limit: 20,
    });

    expect(studentsRepository.listStudents).toHaveBeenCalledWith(
      expect.objectContaining({
        province: 'กรุงเทพมหานคร',
        district: 'เขตปทุมวัน',
        subDistrict: 'รองเมือง',
        enrollmentState: 'current-active',
        page: 1,
        limit: 20,
      }),
      undefined,
    );
  });

  it('returns guarded photo URLs from the student list without exposing storage keys', async () => {
    studentsRepository.listStudents.mockResolvedValue({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'เด็ก ทดสอบ',
          grade: 'ม.1',
          room: '1',
          school_name: 'โรงเรียนทดสอบ',
          school_id: 10010002,
          student_status_label: 'กำลังศึกษา',
          student_status_category: 'STUDYING',
          student_status_badge_variant: 'success',
          photo_storage_key: 'student-photos/person/profile.webp',
          photo_updated_at: '2026-08-10T06:30:00.000Z',
        },
      ],
      totalCount: 1,
    });

    const result = await service.findAll({ page: 1, limit: 20 }, { school_ids: [10010002] });

    expect(result.data[0]).toMatchObject({
      photo_url:
        '/api/students/00000000-0000-4000-8000-000000000001/photo?v=2026-08-10T06%3A30%3A00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('student-photos/person/profile.webp');
  });

  it('denies raw student lists to an EXECUTIVE even when students is re-granted', async () => {
    await expect(
      service.findAll(
        { page: 1, limit: 20 },
        { provinces: ['เชียงใหม่'] },
        {
          id: 70,
          username: 'executive.regranted',
          roles: ['EXECUTIVE'],
          permissions: ['students'],
          data_scope: { provinces: ['เชียงใหม่'] },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(studentsRepository.listStudents).not.toHaveBeenCalled();
  });

  it('passes all-enrollment list mode only when requested', async () => {
    studentsRepository.listStudents.mockResolvedValue({ rows: [], totalCount: 0 });

    await service.findAll({ enrollmentState: 'all', page: 1, limit: 20 });

    expect(studentsRepository.listStudents).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentState: 'all',
      }),
      undefined,
    );
  });

  it('passes student status code to the student list query', async () => {
    studentsRepository.listStudents.mockResolvedValue({ rows: [], totalCount: 0 });

    await service.findAll({ student_status_code: 20, enrollmentState: 'all', page: 1, limit: 20 });

    expect(studentsRepository.listStudents).toHaveBeenCalledWith(
      expect.objectContaining({
        studentStatusCode: 20,
        enrollmentState: 'all',
      }),
      undefined,
    );
  });

  it('passes geo filters to student filter options', async () => {
    studentsRepository.getStudentFilterOptions.mockResolvedValue({ grades: [], rooms: [] });

    await service.getFilterOptions({
      province: 'กรุงเทพมหานคร',
      district: 'เขตปทุมวัน',
      subDistrict: 'รองเมือง',
      grade: 'ม.1',
    });

    expect(studentsRepository.getStudentFilterOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        province: 'กรุงเทพมหานคร',
        district: 'เขตปทุมวัน',
        subDistrict: 'รองเมือง',
        grade: 'ม.1',
        enrollmentState: 'current-active',
      }),
      undefined,
    );
  });

  it('passes student status code to student filter options', async () => {
    studentsRepository.getStudentFilterOptions.mockResolvedValue({ grades: [], rooms: [] });

    await service.getFilterOptions({
      student_status_code: 10,
      enrollmentState: 'current-active',
    });

    expect(studentsRepository.getStudentFilterOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        studentStatusCode: 10,
        enrollmentState: 'current-active',
      }),
      undefined,
    );
  });

  it('loads case history by stable student UUID after a scoped lookup', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    const scope = { school_ids: [10010002] };
    studentsRepository.findStudentById.mockResolvedValue({ student_uuid: studentUuid });
    studentsRepository.findCasesByStudentId.mockResolvedValue([{ id: 10, status: 'OPEN' }]);

    const result = await service.findCasesByStudentId(
      studentUuid,
      { id: 1, username: 'director', roles: ['DIRECTOR'], permissions: ['students'] },
      scope,
    );

    expect(studentsRepository.findStudentById).toHaveBeenCalledWith(studentUuid, scope);
    expect(studentsRepository.findCasesByStudentId).toHaveBeenCalledWith(studentUuid);
    expect(result).toEqual([{ id: 10, status: 'OPEN' }]);
  });

  it('does not expose case history when the student is outside scope', async () => {
    studentsRepository.findStudentById.mockResolvedValue(null);

    await expect(
      service.findCasesByStudentId(
        '00000000-0000-4000-8000-000000000001',
        { id: 1, username: 'director', roles: ['DIRECTOR'], permissions: ['students'] },
        { school_ids: [10010002] },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(studentsRepository.findCasesByStudentId).not.toHaveBeenCalled();
  });

  it('updates a student by UUID after a scoped lookup succeeds', async () => {
    const student = {
      student_uuid: '00000000-0000-4000-8000-000000000001',
      PersonID_Onec: 'masked',
      FirstName_Onec: 'สมชาย',
      LastName_Onec: 'ใจดี',
    };
    studentsRepository.findStudentById.mockResolvedValue(student);
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);

    await service.update(
      student.student_uuid,
      { FirstName_Onec: 'สมศรี' },
      { id: 5, username: 'admin', roles: ['ADMIN'], permissions: ['students'] },
      { school_ids: [10010002] },
    );

    expect(studentsRepository.findStudentById).toHaveBeenCalledWith(student.student_uuid, {
      school_ids: [10010002],
    });
    expect(studentsRepository.updateStudentByUuid).toHaveBeenCalledWith(student.student_uuid, {
      FirstName_Onec: 'สมศรี',
    });
  });

  it('findOne skips the geocode cache when the row already has a confirmed home coordinate', async () => {
    studentsRepository.findStudentById.mockResolvedValue({
      student_uuid: '00000000-0000-4000-8000-000000000001',
      PersonID_Onec: 'masked',
      FirstName_Onec: 'สมชาย',
      LastName_Onec: 'ใจดี',
      resolved_home_lat: 18.79,
      resolved_home_lng: 98.98,
    });
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);

    const result = await service.findOne('00000000-0000-4000-8000-000000000001');

    expect(geocodeCache.resolve).not.toHaveBeenCalled();
    expect(result.resolved_home_lat).toBe(18.79);
    expect(result.resolved_home_lng).toBe(98.98);
    expect(result.is_approximate_home_location).toBe(false);
  });

  it('findOne falls back to the geocode cache when there is no confirmed home coordinate', async () => {
    studentsRepository.findStudentById.mockResolvedValue({
      student_uuid: '00000000-0000-4000-8000-000000000001',
      PersonID_Onec: 'masked',
      FirstName_Onec: 'สมชาย',
      LastName_Onec: 'ใจดี',
      resolved_home_lat: null,
      resolved_home_lng: null,
      ProvinceNameThai_Onec: 'เชียงใหม่',
      DistrictNameThai_Onec: 'เมืองเชียงใหม่',
    });
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);
    geocodeCache.resolve.mockResolvedValue({ lat: 18.8, lng: 99.0 });

    const result = await service.findOne('00000000-0000-4000-8000-000000000001');

    expect(geocodeCache.resolve).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'เมืองเชียงใหม่ เชียงใหม่',
    );
    expect(result.resolved_home_lat).toBe(18.8);
    expect(result.resolved_home_lng).toBe(99.0);
    expect(result.is_approximate_home_location).toBe(true);
  });

  it('returns current-term GPA, cumulative GPAX, and attendance rate from persisted rows', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    studentsRepository.findStudentById.mockResolvedValue({ student_uuid: studentUuid });
    studentsRepository.findStudentProfileSummary.mockResolvedValue({
      academic_year: 2569,
      semester: 1,
      starts_on: '2026-05-16',
      ends_on: '2026-10-10',
      term_gpa: '3.21',
      cumulative_gpax: 3.42,
      present_count: 17,
      absent_count: 1,
      late_count: 1,
      leave_count: 1,
      total_count: 20,
    });
    studentsRepository.listStudentAttendanceCalendar.mockResolvedValue([
      {
        attendance_category: 'ALL_PERIODS',
        attendance_category_label: 'เข้าทุกคาบ',
        date: '2026-08-01',
        status_code: 1,
        status_internal_code: 'ALL_PERIODS',
        status_label: 'เข้าทุกคาบ',
        status_badge_variant: 'success',
      },
    ]);

    await expect(service.getStudentProfileSummary(studentUuid)).resolves.toEqual({
      success: true,
      data: {
        term: {
          academicYear: 2569,
          semester: 1,
          startsOn: '2026-05-16',
          endsOn: '2026-10-10',
        },
        grades: { termGpa: 3.21, cumulativeGpax: 3.42 },
        careConsiderations: { disadvantages: [], disabilities: [] },
        attendance: {
          ratePercent: 94.74,
          counts: { present: 17, absent: 1, late: 1, leave: 1, total: 20 },
          days: [
            {
              attendanceCategory: 'ALL_PERIODS',
              attendanceCategoryLabel: 'เข้าทุกคาบ',
              date: '2026-08-01',
              statusCode: 1,
              statusInternalCode: 'ALL_PERIODS',
              statusLabel: 'เข้าทุกคาบ',
              statusBadgeVariant: 'success',
            },
          ],
        },
      },
    });
  });

  it('rejects a subject-attendance date outside the enrollment term', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    studentsRepository.findStudentById.mockResolvedValue({ student_uuid: studentUuid });
    studentsRepository.findStudentProfileSummary.mockResolvedValue({
      starts_on: '2026-05-16',
      ends_on: '2026-10-10',
    });

    await expect(
      service.getStudentSubjectAttendance(studentUuid, '2026-11-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(studentsRepository.listStudentSubjectAttendanceByDate).not.toHaveBeenCalled();
  });

  it('returns the recorded time and teacher for selected-date subject attendance', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    studentsRepository.findStudentById.mockResolvedValue({ student_uuid: studentUuid });
    studentsRepository.findStudentProfileSummary.mockResolvedValue({
      starts_on: '2026-05-16',
      ends_on: '2026-10-10',
    });
    studentsRepository.listStudentSubjectAttendanceByDate.mockResolvedValue([
      {
        date: '2026-08-02',
        subject_code: 'TH101',
        subject_name: 'ภาษาไทย',
        status_code: 1,
        status_internal_code: 'PRESENT',
        status_label: 'มาเรียน',
        status_badge_variant: 'success',
        recorded_at: '2026-08-02T08:30:00.000Z',
        checking_started_at: '2026-08-02T08:27:00.000Z',
        submitted_at: '2026-08-02T08:32:00.000Z',
        recorded_by: 'ครูสมใจ ใจดี',
      },
    ]);

    await expect(service.getStudentSubjectAttendance(studentUuid, '2026-08-02')).resolves.toEqual({
      success: true,
      data: [
        expect.objectContaining({
          recordedAt: '2026-08-02T08:30:00.000Z',
          checkingStartedAt: '2026-08-02T08:27:00.000Z',
          submittedAt: '2026-08-02T08:32:00.000Z',
          recordedBy: 'ครูสมใจ ใจดี',
        }),
      ],
    });
  });

  it('rejects a GUARDIAN row without relation_note and duplicate primary contacts', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    const staff = { id: 5, username: 'admin', roles: ['ADMIN'], permissions: ['students'] };
    studentsRepository.findStudentById.mockResolvedValue({
      student_uuid: studentUuid,
      PersonID_Onec: 'masked',
    });
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);
    studentsRepository.findPersonUuidByStudentUuid.mockResolvedValue(
      '10000000-0000-4000-8000-000000000001',
    );

    await expect(
      service.update(
        studentUuid,
        { guardians: [{ relation: 'GUARDIAN', full_name: 'สมศรี มีสุข' }] },
        staff,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.update(
        studentUuid,
        {
          guardians: [
            { relation: 'FATHER', full_name: 'สมชาย ใจดี', is_primary: true },
            { relation: 'MOTHER', full_name: 'สมหญิง ใจดี', is_primary: true },
          ],
        },
        staff,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(studentsRepository.updateStudentPersonContacts).not.toHaveBeenCalled();
  });

  it('lets staff add student contact when no login account is linked', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    studentsRepository.findStudentById.mockResolvedValue({
      student_uuid: studentUuid,
      PersonID_Onec: 'masked',
    });
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);
    studentsRepository.findPersonUuidByStudentUuid.mockResolvedValue(
      '10000000-0000-4000-8000-000000000001',
    );
    await service.update(
      studentUuid,
      { contact: { phone: '0812345678' } },
      { id: 5, username: 'admin', roles: ['ADMIN'], permissions: ['students'] },
    );
    expect(studentsRepository.updateStudentPersonContacts).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      { phone: '0812345678' },
      undefined,
      5,
    );
  });
});

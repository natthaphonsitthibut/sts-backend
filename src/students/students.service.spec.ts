import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { StudentsRepository } from './students.repository';
import { StudentGeocodeCacheService } from '../student-geocode/student-geocode-cache.service';
import { piiConfig } from '../config/pii.config';

describe('StudentsService', () => {
  let service: StudentsService;
  let studentsRepository: {
    listStudents: jest.Mock;
    getStudentFilterOptions: jest.Mock;
    findStudentById: jest.Mock;
    findCasesByStudentName: jest.Mock;
    listAttendanceByStudentId: jest.Mock;
    insertPiiAccessEvent: jest.Mock;
    listActiveRevealGroups: jest.Mock;
    updateStudentByUuid: jest.Mock;
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
            listAttendanceByStudentId: jest.fn(),
            insertPiiAccessEvent: jest.fn(),
            listActiveRevealGroups: jest.fn(),
            updateStudentByUuid: jest.fn(),
          },
        },
        {
          provide: StudentGeocodeCacheService,
          useValue: {
            resolve: jest.fn().mockResolvedValue(null),
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
      { id: 5, username: 'admin', roles: ['ADMIN'], permissions: ['edit-students'] },
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
});

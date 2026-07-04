import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { StudentsRepository } from './students.repository';
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
});

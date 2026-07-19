import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { StudentsRepository } from './students.repository';
import { StudentGeocodeCacheService } from '../student-geocode/student-geocode-cache.service';
import { piiConfig } from '../config/pii.config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

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
    findPersonUuidByStudentUuid: jest.Mock;
    findStudentPersonContact: jest.Mock;
    findStudentAccountByPersonUuid: jest.Mock;
    listGuardiansByPersonUuid: jest.Mock;
    updateStudentPersonContacts: jest.Mock;
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
            findPersonUuidByStudentUuid: jest.fn(),
            findStudentPersonContact: jest.fn().mockResolvedValue(null),
            findStudentAccountByPersonUuid: jest.fn().mockResolvedValue(null),
            listGuardiansByPersonUuid: jest.fn().mockResolvedValue([]),
            updateStudentPersonContacts: jest.fn(),
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

  it('keeps student-self attendance limited to the actor own enrollment', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    const actor = {
      id: 50,
      username: 'student.self',
      roles: ['STUDENT'],
      permissions: ['student-self'],
      data_scope: { own_only: true },
      student_uuid: studentUuid,
      person_uuid: '10000000-0000-4000-8000-000000000001',
    };
    studentsRepository.listAttendanceByStudentId.mockResolvedValue([]);

    await expect(service.findAttendanceByStudentId(studentUuid, actor)).resolves.toEqual([]);
    expect(studentsRepository.listAttendanceByStudentId).toHaveBeenCalledWith(
      studentUuid,
      undefined,
    );
  });

  it('lets a student self-edit contact and guardians but never enrollment fields', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    const personUuid = '10000000-0000-4000-8000-000000000001';
    const actor = {
      id: 50,
      username: 'student.self',
      roles: ['STUDENT'],
      permissions: ['student-self'],
      data_scope: { own_only: true },
      student_uuid: studentUuid,
      person_uuid: personUuid,
    };
    studentsRepository.findStudentById.mockResolvedValue({
      student_uuid: studentUuid,
      PersonID_Onec: 'masked',
    });
    studentsRepository.listActiveRevealGroups.mockResolvedValue([]);
    studentsRepository.findPersonUuidByStudentUuid.mockResolvedValue(personUuid);
    studentsRepository.findStudentPersonContact.mockResolvedValue(null);

    await expect(
      service.update(studentUuid, { FirstName_Onec: 'ใหม่' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(studentsRepository.updateStudentByUuid).not.toHaveBeenCalled();

    await service.update(
      studentUuid,
      {
        contact: { phone: '0812345678' },
        guardians: [
          { relation: 'MOTHER', full_name: 'สมหญิง ใจดี', phone: '0898765432', is_primary: true },
        ],
      },
      actor,
    );

    expect(studentsRepository.updateStudentPersonContacts).toHaveBeenCalledWith(
      personUuid,
      { phone: '0812345678' },
      [
        {
          relation: 'MOTHER',
          first_name: 'สมหญิง',
          last_name: 'ใจดี',
          full_name: 'สมหญิง ใจดี',
          phone: '0898765432',
          is_primary: true,
        },
      ],
      50,
    );
    expect(studentsRepository.updateStudentByUuid).not.toHaveBeenCalled();
  });

  it('rejects a GUARDIAN row without relation_note and duplicate primary contacts', async () => {
    const studentUuid = '00000000-0000-4000-8000-000000000001';
    const staff = { id: 5, username: 'admin', roles: ['ADMIN'], permissions: ['edit-students'] };
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
      { id: 5, username: 'admin', roles: ['ADMIN'], permissions: ['edit-students'] },
    );
    expect(studentsRepository.updateStudentPersonContacts).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      { phone: '0812345678' },
      undefined,
      5,
    );
  });

  it('denies student-self detail for another canonical person', async () => {
    const requestedUuid = '00000000-0000-4000-8000-000000000002';
    const actor = {
      id: 50,
      username: 'student.self',
      roles: ['STUDENT'],
      permissions: ['student-self'],
      data_scope: { own_only: true },
      student_uuid: '00000000-0000-4000-8000-000000000001',
      person_uuid: '10000000-0000-4000-8000-000000000001',
    };
    studentsRepository.findPersonUuidByStudentUuid.mockResolvedValue(
      '10000000-0000-4000-8000-000000000002',
    );

    await expect(service.findOne(requestedUuid, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(studentsRepository.findStudentById).not.toHaveBeenCalled();
  });
});

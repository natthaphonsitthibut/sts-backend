import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateStudentDto } from './dto/create-student.dto';
import type { GetStudentsQueryDto } from './dto/students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import type { DataScope } from '../common/utils/authorization';
import { StudentsRepository } from './students.repository';
import type { StudentDetailRow, StudentListFilters, StudentListRow } from './students.types';
import type { AuthenticatedRequestUser } from '../auth';

function parseOptionalInteger(value?: string): number | undefined {
  if (!value || value === 'ALL' || value === 'all') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeStudentListFilters(queryParams?: GetStudentsQueryDto): StudentListFilters {
  if (!queryParams) {
    return {};
  }

  const searchTerm = queryParams.searchTerm?.trim();

  return {
    grade: queryParams.grade && queryParams.grade !== 'ALL' ? queryParams.grade : undefined,
    room: parseOptionalInteger(queryParams.room),
    schoolId: parseOptionalInteger(queryParams.schoolId),
    searchTerm: searchTerm && searchTerm.length > 0 ? searchTerm : undefined,
  };
}

function isOwnOnlyStudentActor(
  actor?: AuthenticatedRequestUser,
): actor is AuthenticatedRequestUser & { PersonID_Onec: string } {
  return Boolean(
    actor?.roles.includes('STUDENT') &&
    actor.virtual_login &&
    actor.PersonID_Onec &&
    actor.data_scope?.own_only,
  );
}

function mapDetailRowToListRow(student: StudentDetailRow): StudentListRow {
  const firstName =
    typeof student['FirstName_Onec'] === 'string'
      ? student['FirstName_Onec']
      : typeof student['FirstName'] === 'string'
        ? student['FirstName']
        : '';
  const lastName =
    typeof student['LastName_Onec'] === 'string'
      ? student['LastName_Onec']
      : typeof student['LastName'] === 'string'
        ? student['LastName']
        : '';

  const schoolId =
    typeof student['SchoolID_Onec'] === 'number'
      ? student['SchoolID_Onec']
      : typeof student['SchoolID_Onec'] === 'string'
        ? Number.parseInt(student['SchoolID_Onec'], 10)
        : null;

  return {
    id: student.PersonID_Onec,
    name: `${firstName} ${lastName}`.trim() || student.PersonID_Onec,
    grade:
      typeof student.grade === 'string' && student.grade.trim().length > 0
        ? student.grade
        : 'ไม่ทราบ',
    room: typeof student.room === 'string' && student.room.trim().length > 0 ? student.room : '-',
    school_name: typeof student.school_name === 'string' ? student.school_name : null,
    school_id: Number.isFinite(schoolId) ? schoolId : null,
  };
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(private readonly studentsRepository: StudentsRepository) {}

  create(createStudentDto: CreateStudentDto) {
    void createStudentDto;
    return 'This action adds a new student';
  }

  async findAll(
    queryParams?: GetStudentsQueryDto,
    userScope?: DataScope,
    actor?: AuthenticatedRequestUser,
  ) {
    try {
      if (isOwnOnlyStudentActor(actor)) {
        const ownStudent = await this.studentsRepository.findStudentById(actor.PersonID_Onec);

        return {
          success: true,
          data: ownStudent ? [mapDetailRowToListRow(ownStudent)] : [],
        };
      }

      const students = await this.studentsRepository.listStudents(
        normalizeStudentListFilters(queryParams),
        userScope,
      );

      return { success: true, data: students };
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findAll error: ${resolvedError.message}`);
      throw error;
    }
  }

  async findOne(id: string, actor?: AuthenticatedRequestUser, userScope?: DataScope) {
    try {
      this.assertOwnStudentAccess(id, actor);
      const student = await this.studentsRepository.findStudentById(id, userScope);

      if (!student) {
        throw new NotFoundException(`Student with ID ${id} not found`);
      }

      return student;
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      const error = err as Error;
      this.logger.error(`findOne error: ${error.message}`);
      throw err;
    }
  }

  async findCasesByName(name: string, actor?: AuthenticatedRequestUser) {
    try {
      if (isOwnOnlyStudentActor(actor)) {
        return [];
      }

      return await this.studentsRepository.findCasesByStudentName(name);
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findCasesByName error: ${resolvedError.message}`);
      throw error;
    }
  }

  async findAttendanceByStudentId(
    id: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    try {
      this.assertOwnStudentAccess(id, actor);
      return await this.studentsRepository.listAttendanceByStudentId(id, userScope);
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findAttendanceByStudentId error: ${resolvedError.message}`);
      throw error;
    }
  }

  update(id: number, updateStudentDto: UpdateStudentDto) {
    void updateStudentDto;
    return `This action updates a #${id} student`;
  }

  remove(id: number) {
    return `This action removes a #${id} student`;
  }

  private assertOwnStudentAccess(
    requestedStudentId: string,
    actor?: AuthenticatedRequestUser,
  ): void {
    if (!isOwnOnlyStudentActor(actor)) {
      return;
    }

    if (!actor.PersonID_Onec) {
      throw new UnauthorizedException('ไม่พบข้อมูลนักเรียนใน session');
    }

    if (actor.PersonID_Onec !== requestedStudentId) {
      throw new NotFoundException(`Student with ID ${requestedStudentId} not found`);
    }
  }
}

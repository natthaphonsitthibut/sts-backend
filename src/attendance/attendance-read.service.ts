import { BadRequestException, Injectable } from '@nestjs/common';
import type { DataScope } from '../common/utils/authorization';
import { AttendanceRepository } from './attendance.repository';
import { attendanceStatusFromCode } from './attendance-status';

@Injectable()
export class AttendanceReadService {
  constructor(private readonly attendanceRepository: AttendanceRepository) {}

  async getStudents(grade?: string, room?: string, schoolId?: string, userScope?: DataScope) {
    const normalizedGrade = grade && grade !== 'ALL' ? grade.trim() || undefined : undefined;
    const normalizedRoom = this.parseOptionalInteger(
      room && room !== 'all' && room !== 'ALL' ? room : undefined,
      'room',
    );
    const normalizedSchoolId = this.parseOptionalInteger(schoolId, 'schoolId');

    const data = await this.attendanceRepository.listStudents(
      {
        grade: normalizedGrade,
        room: normalizedRoom,
        schoolId: normalizedSchoolId,
      },
      userScope,
    );

    return { success: true, data };
  }

  async getHistory(
    date: string,
    userScope?: DataScope,
    schoolId?: number | null,
    sessionKind?: 'DAILY' | 'SUBJECT',
    timetableSlotId?: number,
  ) {
    const rows = await this.attendanceRepository.listAttendanceHistory(
      date,
      userScope,
      schoolId,
      sessionKind,
      timetableSlotId,
    );

    const data = rows.map((row) => ({
      ...row,
      status: attendanceStatusFromCode(row.status),
    }));

    return { success: true, data };
  }

  async getAttendanceTasks(userScope?: DataScope) {
    return await this.attendanceRepository.listAttendanceTasks(userScope);
  }

  async getAttendanceTasksPaginated(
    userScope: DataScope | undefined,
    filters: {
      page: number;
      limit: number;
      searchTerm?: string;
      status?: string;
      province?: string;
      district?: string;
      subDistrict?: string;
      schoolId?: number;
      grade?: string;
      room?: string;
    },
  ) {
    const { rows, totalCount, summary } =
      await this.attendanceRepository.listAttendanceTasksPaginated(userScope, filters);
    return { rows, totalCount, page: filters.page, limit: filters.limit, summary };
  }

  private parseOptionalInteger(value: string | undefined, fieldName: string): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException(`${fieldName} is invalid`);
    }

    return parsed;
  }
}

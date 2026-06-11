import { BadRequestException, Injectable } from '@nestjs/common';
import type { DataScope } from '../common/utils/authorization';
import { AttendanceRepository } from './attendance.repository';

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

  async getHistory(date: string, userScope?: DataScope) {
    const rows = await this.attendanceRepository.listAttendanceHistory(date, userScope);

    const data = rows.map((row) => ({
      ...row,
      status: this.mapHistoryStatus(row.status),
    }));

    return { success: true, data };
  }

  async getAttendanceTasks(userScope?: DataScope) {
    return await this.attendanceRepository.listAttendanceTasks(userScope);
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

  private mapHistoryStatus(status: unknown): string {
    const code =
      typeof status === 'number'
        ? status
        : typeof status === 'string'
          ? Number.parseInt(status, 10)
          : Number.NaN;

    if (code === 1) {
      return 'P_PRESENT';
    }
    if (code === 2) {
      return 'P_ABSENT';
    }
    if (code === 3) {
      return 'P_LATE';
    }
    return 'NONE';
  }
}

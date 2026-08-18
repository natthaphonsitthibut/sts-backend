import { BadRequestException, Injectable } from '@nestjs/common';
import type { DataScope } from '../common/utils/authorization';
import { encodeMediaVersion } from '../common/utils/media-version.util';
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

    return {
      success: true,
      data: data.map(
        ({ photo_storage_key: photoStorageKey, photo_updated_at: photoUpdatedAt, ...student }) => ({
          ...student,
          photo_url: photoStorageKey
            ? `/api/students/${encodeURIComponent(student.id)}/photo?v=${encodeMediaVersion(photoUpdatedAt)}`
            : null,
        }),
      ),
    };
  }

  async getHistory(
    date: string,
    userScope?: DataScope,
    schoolId?: number | null,
    sessionKind?: 'SUBJECT',
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

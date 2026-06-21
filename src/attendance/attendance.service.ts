import { Injectable } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import type { DataScope } from '../common/utils/authorization';
import { AttendanceLookupService } from './attendance-lookup.service';
import { AttendanceReadService } from './attendance-read.service';
import { AttendanceWriteService } from './attendance-write.service';
import type { AttendanceSaveRecordInput } from './attendance.types';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly attendanceLookupService: AttendanceLookupService,
    private readonly attendanceReadService: AttendanceReadService,
    private readonly attendanceWriteService: AttendanceWriteService,
  ) {}

  async getGradeLevels() {
    return await this.attendanceLookupService.getGradeLevels();
  }

  async getSchools(province?: string, district?: string, subDistrict?: string) {
    return await this.attendanceLookupService.getSchools(province, district, subDistrict);
  }

  async getLocations() {
    return await this.attendanceLookupService.getLocations();
  }

  async getStudents(grade?: string, room?: string, schoolId?: string, userScope?: DataScope) {
    return await this.attendanceReadService.getStudents(grade, room, schoolId, userScope);
  }

  async getHistory(date: string, userScope?: DataScope, schoolId?: number | null) {
    return await this.attendanceReadService.getHistory(date, userScope, schoolId);
  }

  async saveAttendance(records: AttendanceSaveRecordInput[], actor?: AuthenticatedRequestUser) {
    return await this.attendanceWriteService.saveAttendance(records, actor);
  }

  async getAttendanceTasks(userScope?: DataScope) {
    return await this.attendanceReadService.getAttendanceTasks(userScope);
  }

  async getRooms(gradeLabel: string, schoolId?: string) {
    return await this.attendanceLookupService.getRooms(gradeLabel, schoolId);
  }
}

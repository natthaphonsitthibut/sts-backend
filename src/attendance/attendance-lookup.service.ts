import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendanceRepository } from './attendance.repository';

@Injectable()
export class AttendanceLookupService {
  constructor(private readonly attendanceRepository: AttendanceRepository) {}

  async getGradeLevels() {
    const data = await this.attendanceRepository.listGradeLevels();
    return { success: true, data };
  }

  async getSchools(province?: string, district?: string, subDistrict?: string) {
    const data = await this.attendanceRepository.listSchools({
      province,
      district,
      subDistrict,
    });

    return { success: true, data };
  }

  async getLocations() {
    const [provinces, districts, subDistricts] = await Promise.all([
      this.attendanceRepository.listLocationProvinces(),
      this.attendanceRepository.listLocationDistricts(),
      this.attendanceRepository.listLocationSubDistricts(),
    ]);

    return {
      success: true,
      data: {
        provinces: provinces.map((row) => row.province),
        districts,
        subDistricts,
      },
    };
  }

  async getRooms(gradeLabel: string, schoolId?: string) {
    const normalizedGrade = gradeLabel.trim();
    if (!normalizedGrade) {
      throw new BadRequestException('Grade is required');
    }

    const normalizedSchoolId = this.parseOptionalInteger(schoolId, 'schoolId');
    const rows = await this.attendanceRepository.listRooms(normalizedGrade, normalizedSchoolId);

    return {
      success: true,
      data: rows.map((row) => row.room),
    };
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

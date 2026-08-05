import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth';
import { AttendanceService } from './attendance.service';

/**
 * Area catalog (province/district/sub-district of onboarded schools) used by the
 * guest home-visit form to build its address cascade before any account exists.
 * It carries no student or account data, so it lives under the `api/public`
 * namespace where the unauthenticated surface is declared, instead of leaving an
 * ungated route inside the permission-guarded attendance module.
 */
@Controller('api/public/locations')
export class PublicLocationsController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Public()
  @Get()
  async getLocations() {
    return await this.attendanceService.getLocations();
  }
}

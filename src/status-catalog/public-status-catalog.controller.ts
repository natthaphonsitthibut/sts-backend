import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth';
import { StatusCatalogService } from './status-catalog.service';

@Public()
@Controller('api/public/status-catalogs')
export class PublicStatusCatalogController {
  constructor(private readonly statusCatalogService: StatusCatalogService) {}

  @Get('attendance-record')
  async getAttendanceRecordStatuses() {
    return await this.statusCatalogService.getCatalog('ATTENDANCE_RECORD');
  }

  /** The teacher and delegation links render ประวัติการมอบหมาย without a session. */
  @Get('attendance-delegation')
  async getAttendanceDelegationStatuses() {
    return await this.statusCatalogService.getCatalog('ATTENDANCE_DELEGATION');
  }
}

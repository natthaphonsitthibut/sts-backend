import { Controller, Get } from '@nestjs/common';
import { StatusCatalogService } from './status-catalog.service';

@Controller('api/public/status-catalogs')
export class PublicStatusCatalogController {
  constructor(private readonly statusCatalogService: StatusCatalogService) {}

  @Get('attendance-record')
  async getAttendanceRecordStatuses() {
    return await this.statusCatalogService.getCatalog('ATTENDANCE_RECORD');
  }
}

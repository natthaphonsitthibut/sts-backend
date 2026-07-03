import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth';
import { StatusCatalogService } from './status-catalog.service';

@UseGuards(AuthGuard)
@Controller('api/status-catalogs')
export class StatusCatalogController {
  constructor(private readonly statusCatalogService: StatusCatalogService) {}

  @Get()
  async getCatalogs() {
    return await this.statusCatalogService.getCatalogs();
  }
}

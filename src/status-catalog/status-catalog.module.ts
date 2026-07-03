import { Module } from '@nestjs/common';
import { StatusCatalogController } from './status-catalog.controller';
import { PublicStatusCatalogController } from './public-status-catalog.controller';
import { StatusCatalogRepository } from './status-catalog.repository';
import { StatusCatalogService } from './status-catalog.service';

@Module({
  controllers: [StatusCatalogController, PublicStatusCatalogController],
  providers: [StatusCatalogRepository, StatusCatalogService],
  exports: [StatusCatalogService],
})
export class StatusCatalogModule {}

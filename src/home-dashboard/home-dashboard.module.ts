import { Module } from '@nestjs/common';
import { HomeDashboardController } from './home-dashboard.controller';
import { HomeDashboardRepository } from './home-dashboard.repository';
import { HomeDashboardService } from './home-dashboard.service';

@Module({
  controllers: [HomeDashboardController],
  providers: [HomeDashboardRepository, HomeDashboardService],
})
export class HomeDashboardModule {}

import { Module } from '@nestjs/common';
import { HomeDashboardCacheModule } from './home-dashboard-cache.module';
import { HomeDashboardController } from './home-dashboard.controller';
import { HomeDashboardRepository } from './home-dashboard.repository';
import { HomeDashboardService } from './home-dashboard.service';

@Module({
  imports: [HomeDashboardCacheModule],
  controllers: [HomeDashboardController],
  providers: [HomeDashboardRepository, HomeDashboardService],
})
export class HomeDashboardModule {}

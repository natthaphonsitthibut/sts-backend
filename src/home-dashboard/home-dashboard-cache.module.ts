import { Module } from '@nestjs/common';
import { AttendanceTrendCache } from './attendance-trend-cache.service';

@Module({ providers: [AttendanceTrendCache], exports: [AttendanceTrendCache] })
export class HomeDashboardCacheModule {}

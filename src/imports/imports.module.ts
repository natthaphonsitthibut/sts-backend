import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsRepository } from './imports.repository';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsRepository],
})
export class ImportsModule {}

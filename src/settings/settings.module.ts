import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AutomationModule } from '../automation/automation.module';
import { SettingsRepository } from './settings.repository';

@Module({
  imports: [AutomationModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService],
})
export class SettingsModule {}

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import { UpdateSettingDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('settings')
@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Get(':key')
  getSettingByKey(@Param('key') key: string) {
    return this.settingsService.getSettingByKey(key);
  }

  @Put(':key')
  updateSetting(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('key') key: string,
    @Body() body: UpdateSettingDto,
  ) {
    return this.settingsService.updateSetting(actor, key, body.value);
  }
}

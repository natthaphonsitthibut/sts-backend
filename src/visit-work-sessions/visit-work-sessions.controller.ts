import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, CurrentUser, PermissionsGuard, Public, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { getHeaderValue } from '../task/task.types';
import {
  EndWorkSessionDto,
  PositionPingDto,
  StartWorkSessionDto,
} from './dto/visit-work-sessions.dto';
import { VisitWorkSessionsService } from './visit-work-sessions.service';

@Controller('api/tasks')
export class GuestWorkSessionController {
  constructor(private readonly workSessionsService: VisitWorkSessionsService) {}

  @Public()
  @Get(':token/work-session')
  async status(@Param('token') token: string, @Req() req: Request) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    return await this.workSessionsService.getStatus(token, sessionToken);
  }

  @Public()
  @Post(':token/work-session/start')
  async start(
    @Param('token') token: string,
    @Body() body: StartWorkSessionDto,
    @Req() req: Request,
  ) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    return await this.workSessionsService.startSession(token, body.consent, sessionToken);
  }

  @Public()
  @Post(':token/work-session/end')
  async end(@Param('token') token: string, @Body() body: EndWorkSessionDto, @Req() req: Request) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    return await this.workSessionsService.endSession(token, body, sessionToken);
  }

  @Public()
  @Post(':token/position')
  async position(
    @Param('token') token: string,
    @Body() body: PositionPingDto,
    @Req() req: Request,
  ) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    return await this.workSessionsService.recordPosition(token, body.lat, body.lng, sessionToken);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('field-monitor')
@Controller('api/field-monitor')
export class WorkSessionMonitorController {
  constructor(private readonly workSessionsService: VisitWorkSessionsService) {}

  @Get('work-sessions')
  async list(@CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.workSessionsService.listForMonitor(actor);
  }
}

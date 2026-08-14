import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  AuthGuard,
  CurrentUser,
  Public,
  RequireRoles,
  RolesGuard,
  type AuthenticatedRequestUser,
} from '../auth';
import { ThrottleLogin } from '../config/throttle.decorators';
import { AraIdSessionCookieService } from './araid-session-cookie.service';
import { AraIdService } from './araid.service';
import {
  AraIdLoginDto,
  CreateAraIdRecordDto,
  ListAraIdRecordsDto,
  UpdateAraIdRecordDto,
  UpdateAraIdRecordStatusDto,
} from './dto/araid.dto';

@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN')
@Controller('api/araid/records')
export class AraIdManagementController {
  constructor(
    private readonly araIdService: AraIdService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  async list(@Query() query: ListAraIdRecordsDto) {
    const { records, meta, counts } = await this.araIdService.listRecords(query);
    return { success: true, data: records, meta, counts };
  }

  @Get(':recordId')
  async detail(@Param('recordId', ParseUUIDPipe) recordId: string) {
    return { success: true, data: await this.araIdService.getRecord(recordId) };
  }

  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: CreateAraIdRecordDto,
    @Req() request: Request,
  ) {
    const record = await this.araIdService.createRecord(actor.id, body);
    await this.auditLog.record({
      action: 'USER_CREATE',
      actorUserId: actor.id,
      actorLabel: actor.username,
      targetType: 'araid_record',
      targetId: record.id,
      metadata: { fieldCount: Object.keys(body).length },
      ip: request.ip ?? null,
    });
    return { success: true, data: record };
  }

  @Put(':recordId')
  async update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() body: UpdateAraIdRecordDto,
    @Req() request: Request,
  ) {
    const record = await this.araIdService.updateRecord(actor.id, recordId, body);
    await this.auditLog.record({
      action: 'USER_PROFILE_UPDATE',
      actorUserId: actor.id,
      actorLabel: actor.username,
      targetType: 'araid_record',
      targetId: record.id,
      metadata: { fieldCount: Object.keys(body).length },
      ip: request.ip ?? null,
    });
    return { success: true, data: record };
  }

  @Patch(':recordId/status')
  async updateStatus(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() body: UpdateAraIdRecordStatusDto,
    @Req() request: Request,
  ) {
    const record = await this.araIdService.updateRecordStatus(
      actor.id,
      recordId,
      body.recordStatus,
    );
    await this.auditLog.record({
      action: 'USER_PROFILE_UPDATE',
      actorUserId: actor.id,
      actorLabel: actor.username,
      targetType: 'araid_record',
      targetId: recordId,
      metadata: { recordStatus: body.recordStatus },
      ip: request.ip ?? null,
    });
    return { success: true, data: record };
  }
}

@Controller('api/araid/session')
export class AraIdSessionController {
  constructor(
    private readonly araIdService: AraIdService,
    private readonly sessionCookie: AraIdSessionCookieService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Public()
  @ThrottleLogin()
  @Post('login')
  async login(
    @Body() body: AraIdLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const profile = await this.araIdService.login(body.identityNumber, body.pin);
      this.sessionCookie.setSession(response, profile.profileId);
      await this.auditLog.record({
        action: 'LOGIN',
        actorLabel: 'AraID',
        targetType: 'araid_profile',
        targetId: profile.profileId,
        metadata: { authMethod: 'ARAID_PIN' },
        ip: request.ip ?? null,
      });
      return { success: true, data: profile };
    } catch (error) {
      await this.auditLog.record({
        action: 'LOGIN_FAILED',
        actorLabel: 'AraID',
        targetType: 'araid_profile',
        metadata: { authMethod: 'ARAID_PIN' },
        ip: request.ip ?? null,
      });
      throw error;
    }
  }

  @Public()
  @Get('me')
  async current(@Req() request: Request) {
    const profileId = this.sessionCookie.readProfileId(request.headers.cookie);
    if (!profileId) throw new UnauthorizedException('ไม่ได้เข้าสู่ระบบ AraID');
    return { success: true, data: await this.araIdService.getSessionProfile(profileId) };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    this.sessionCookie.clearSession(response);
    this.sessionCookie.clearLineAuthorization(response);
    this.sessionCookie.clearTeacherAccessAuthorization(response);
    return { success: true };
  }
}

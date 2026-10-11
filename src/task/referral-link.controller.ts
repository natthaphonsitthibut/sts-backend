import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { Public } from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { ThrottleIdentityStart, ThrottleIdentityVerify } from '../config/throttle.decorators';
import { ReferralLinkAccessCodeDto, SubmitReferralReportDto } from './dto/task.dto';
import { ReferralLinkService } from './referral-link.service';
import { getHeaderValue } from './task.types';

/**
 * The agency's referral link (tasks/task-agency-referral-report-link.md). Every
 * route is public and throttled; what a caller may see or do is decided by the
 * link token, the access code and the AraID-verified session — the same shape
 * as the teacher's `/api/tasks/:token` routes, under its own AraID scope.
 */
@Controller('api/referral-links')
export class ReferralLinkController {
  constructor(
    private readonly referralLinkService: ReferralLinkService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
    private readonly araIdSessionCookie: AraIdSessionCookieService,
  ) {}

  @Public()
  @ThrottleIdentityVerify()
  @Get(':token')
  async getLink(@Param('token') token: string, @Req() req: Request) {
    return await this.referralLinkService.getLink(
      token,
      getHeaderValue(req.headers['x-referral-session']),
    );
  }

  @Public()
  @ThrottleIdentityVerify()
  @Get(':token/student-photo')
  async getStudentPhoto(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.referralLinkService.resolveStudentPhoto(
      token,
      getHeaderValue(req.headers['x-referral-session']),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', result.contentType);
    result.stream.on('error', () => res.destroy());
    res.on('close', () => result.stream.destroy());
    result.stream.pipe(res);
  }

  /** The access code is checked here; only a right one starts AraID. */
  @Public()
  @ThrottleIdentityStart()
  @Post(':token/araid/challenge')
  async createAraIdChallenge(
    @Param('token') token: string,
    @Body() body: ReferralLinkAccessCodeDto,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return await this.referralLinkService.createAraIdChallenge(token, body, baseUrl);
  }

  @Public()
  @ThrottleIdentityStart()
  @Post('araid/challenge/begin')
  async beginAraIdChallenge(
    @Headers('x-referral-araid-challenge') rawChallenge: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = await this.referralLinkService.beginAraIdChallenge(
      (rawChallenge ?? '').trim(),
      this.araIdSessionCookie.readReferralLinkAuthorization(request.headers.cookie) ?? undefined,
    );
    this.araIdSessionCookie.setReferralLinkAuthorization(
      response,
      authorization.authorizationToken,
      Math.max(1, Math.ceil((authorization.expiresAt - Date.now()) / 1000)),
    );
    return {
      success: true,
      data: { expiresAt: new Date(authorization.expiresAt).toISOString() },
    };
  }

  @Public()
  @ThrottleIdentityVerify()
  @Post('araid/challenge/approve')
  async approveAraIdChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = this.araIdSessionCookie.readSessionIdentity(request.headers.cookie);
    if (!session) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ AraID');
    const authorizationToken = this.araIdSessionCookie.readReferralLinkAuthorization(
      request.headers.cookie,
    );
    if (!authorizationToken) throw new UnauthorizedException('การยืนยัน AraID หมดอายุแล้ว');
    const result = await this.referralLinkService.approveAraIdChallenge(
      authorizationToken,
      session.profileId,
      session.authenticatedAt,
    );
    this.araIdSessionCookie.clearReferralLinkAuthorization(response);
    return result;
  }

  @Public()
  @ThrottleIdentityVerify()
  @Post('araid/challenge/status')
  async pollAraIdChallenge(
    @Headers('x-referral-araid-challenge') rawChallenge: string | undefined,
  ) {
    return await this.referralLinkService.pollAraIdChallenge((rawChallenge ?? '').trim());
  }

  @Public()
  @ThrottleIdentityVerify()
  @Post(':token/report')
  @HttpCode(HttpStatus.OK)
  async submitReport(
    @Param('token') token: string,
    @Body() body: SubmitReferralReportDto,
    @Req() req: Request,
  ) {
    return await this.referralLinkService.submitReport(
      token,
      body,
      getHeaderValue(req.headers['x-referral-session']),
    );
  }
}

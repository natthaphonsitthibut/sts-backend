import { Controller, Headers, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { ThrottleAraIdLogin } from '../config/throttle.decorators';
import { AraIdLoginService } from './araid-login.service';
import { Public } from './public.decorator';
import { SessionCookieService } from './session-cookie.service';

const ARAID_CHALLENGE_HEADER = 'x-auth-araid-challenge';

@Public()
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly araIdLoginService: AraIdLoginService,
    private readonly araIdSessionCookie: AraIdSessionCookieService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly auditLog: AuditLogService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  @ThrottleAraIdLogin()
  @Post('araid/challenge')
  async createAraIdChallenge(@Req() request: Request) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return { success: true, data: await this.araIdLoginService.createChallenge(baseUrl) };
  }

  @ThrottleAraIdLogin()
  @Post('araid/challenge/begin')
  async beginAraIdChallenge(
    @Headers(ARAID_CHALLENGE_HEADER) rawChallenge: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = await this.araIdLoginService.beginChallenge(
      (rawChallenge ?? '').trim(),
      this.araIdSessionCookie.readAdminLoginAuthorization(request.headers.cookie) ?? undefined,
    );
    this.araIdSessionCookie.setAdminLoginAuthorization(
      response,
      authorization.authorizationToken,
      Math.max(1, Math.ceil((authorization.expiresAt - Date.now()) / 1000)),
    );
    return { success: true, data: { expiresAt: new Date(authorization.expiresAt).toISOString() } };
  }

  @ThrottleAraIdLogin()
  @Post('araid/challenge/approve')
  async approveAraIdChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = this.araIdSessionCookie.readSessionIdentity(request.headers.cookie);
    if (!session) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ AraID');
    const authorizationToken = this.araIdSessionCookie.readAdminLoginAuthorization(
      request.headers.cookie,
    );
    if (!authorizationToken) throw new UnauthorizedException('การยืนยัน AraID หมดอายุแล้ว');
    const result = await this.araIdLoginService.approveChallenge(
      authorizationToken,
      session.profileId,
      session.authenticatedAt,
    );
    this.araIdSessionCookie.clearAdminLoginAuthorization(response);
    return { success: true, data: result };
  }

  @ThrottleAraIdLogin()
  @Post('araid/challenge/status')
  async pollAraIdChallenge(
    @Headers(ARAID_CHALLENGE_HEADER) rawChallenge: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.araIdLoginService.pollChallenge((rawChallenge ?? '').trim());
    if (result.status === 'APPROVED') {
      this.sessionCookieService.setSession(response, result.userId);
      await this.auditLog.record({
        action: 'LOGIN',
        actorUserId: result.userId,
        metadata: { authMethod: 'ARAID_QR' },
        ip: request.ip || null,
      });
      return { success: true, data: { status: result.status } };
    }
    return { success: true, data: result };
  }
}

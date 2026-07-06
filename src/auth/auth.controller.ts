import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ThrottleMockLogin } from '../config/throttle.decorators';
import { Public } from './public.decorator';
import { MockThaIdLoginDto } from './dto/auth.dto';
import { StudentAuthService } from './student-auth.service';
import { SessionCookieService } from './session-cookie.service';

@Public()
@Controller('api/auth/thaid')
export class AuthController {
  constructor(
    private readonly studentAuthService: StudentAuthService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly auditLog: AuditLogService,
  ) {}

  @ThrottleMockLogin()
  @Post('mock/login')
  async loginWithMockThaId(
    @Body() body: MockThaIdLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const user = await this.studentAuthService.loginWithMockThaId(body.personId);
      this.sessionCookieService.setSession(res, user.id);
      await this.auditLog.record({
        action: 'LOGIN',
        actorUserId: user.id,
        actorLabel: user.username,
        metadata: { auth_method: 'THAID_MOCK' },
        ip: req.ip || null,
      });
      return user;
    } catch (error) {
      await this.auditLog.record({
        action: 'LOGIN_FAILED',
        actorLabel: 'THAID_MOCK',
        metadata: { auth_method: 'THAID_MOCK' },
        ip: req.ip || null,
      });
      throw error;
    }
  }
}

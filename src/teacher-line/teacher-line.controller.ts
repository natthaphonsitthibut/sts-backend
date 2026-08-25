import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  type RawBodyRequest,
  Res,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import {
  StartTeacherLineAuthorizationDto,
  TeacherLineAraIdChallengeTokenDto,
  TeacherLineCallbackDto,
  TeacherLineDevelopmentGoogleDto,
  TeacherLineInvitationTokenDto,
} from './dto/teacher-line.dto';
import { TeacherLineService } from './teacher-line.service';

/**
 * Public because a teacher linking their LINE account has no account to sign in
 * with — Google/AraID verifies the teacher before LINE OAuth. Every route is rate limited.
 *
 * The path is LINE-shaped on purpose: `code`/`state` are that provider's OAuth
 * contract, and the callback URL is registered character-for-character in the
 * LINE console, so it cannot be renamed without changing it there too.
 */
@Public()
@Controller('api/line/link')
export class TeacherLineController {
  constructor(
    private readonly service: TeacherLineService,
    private readonly araIdSessionCookie: AraIdSessionCookieService,
  ) {}

  /** Lets the page hide the whole flow when the integration is switched off. */
  @Get('status')
  status() {
    return { success: true, data: { enabled: this.service.isEnabled() } };
  }

  @Post('araid/verify')
  @ThrottleTeacherAccess()
  async verifyAraId(@Body() body: TeacherLineInvitationTokenDto, @Req() request: Request) {
    const profileId = this.araIdSessionCookie.readProfileId(request.headers.cookie);
    if (!profileId) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ AraID');
    return {
      success: true,
      data: await this.service.verifyAraId(body.token, profileId),
    };
  }

  @Post('araid/challenge')
  @ThrottleTeacherAccess()
  async createAraIdChallenge(@Body() body: TeacherLineInvitationTokenDto) {
    return {
      success: true,
      data: await this.service.createAraIdChallenge(body.token),
    };
  }

  @Post('araid/challenge/details')
  @ThrottleTeacherAccess()
  async getAraIdChallenge(@Body() body: TeacherLineAraIdChallengeTokenDto) {
    return {
      success: true,
      data: await this.service.getAraIdChallenge(body.challengeToken),
    };
  }

  @Post('araid/challenge/begin')
  @ThrottleTeacherAccess()
  async beginAraIdChallenge(
    @Body() body: TeacherLineAraIdChallengeTokenDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = await this.service.beginAraIdChallenge(body.challengeToken);
    this.araIdSessionCookie.setLineAuthorization(
      response,
      authorization.authorizationToken,
      Math.max(1, Math.ceil((authorization.expiresAt.getTime() - Date.now()) / 1000)),
    );
    return {
      success: true,
      data: { expiresAt: authorization.expiresAt.toISOString() },
    };
  }

  @Post('araid/challenge/approve')
  @ThrottleTeacherAccess()
  async approveAraIdChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const profileId = this.araIdSessionCookie.readProfileId(request.headers.cookie);
    if (!profileId) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ AraID');
    const authorizationToken = this.araIdSessionCookie.readLineAuthorization(
      request.headers.cookie,
    );
    if (!authorizationToken) throw new UnauthorizedException('การยืนยัน AraID หมดอายุแล้ว');
    await this.service.approveAraIdChallenge(authorizationToken, profileId);
    this.araIdSessionCookie.clearLineAuthorization(response);
    return { success: true, data: { approved: true } };
  }

  @Post('araid/challenge/status')
  @ThrottleTeacherAccess()
  async pollAraIdChallenge(@Body() body: TeacherLineAraIdChallengeTokenDto) {
    return {
      success: true,
      data: await this.service.pollAraIdChallenge(body.challengeToken),
    };
  }

  @Post('group-invitation/resolve')
  @ThrottleTeacherAccess()
  async resolveGroupInvitation(@Body() body: TeacherLineInvitationTokenDto) {
    return { success: true, data: await this.service.resolveGroupInvitation(body.token) };
  }

  @Post('google/start')
  @ThrottleTeacherAccess()
  async startGroupGoogle(@Body() body: TeacherLineInvitationTokenDto) {
    return {
      success: true,
      data: { authorizationUrl: await this.service.startGroupGoogleAuthorization(body.token) },
    };
  }

  @Post('invitation/google/start')
  @ThrottleTeacherAccess()
  async startInvitationGoogle(@Body() body: TeacherLineInvitationTokenDto) {
    return {
      success: true,
      data: {
        authorizationUrl: await this.service.startInvitationGoogleAuthorization(body.token),
      },
    };
  }

  @Post('google/development')
  @ThrottleTeacherAccess()
  async developmentGroupGoogle(@Body() body: TeacherLineDevelopmentGoogleDto) {
    return {
      success: true,
      data: {
        authorizationUrl: await this.service.developmentGroupGoogleAuthorization(
          body.token,
          body.email,
        ),
      },
    };
  }

  @Post('invitation/google/development')
  @ThrottleTeacherAccess()
  async developmentInvitationGoogle(@Body() body: TeacherLineDevelopmentGoogleDto) {
    return {
      success: true,
      data: {
        authorizationUrl: await this.service.developmentInvitationGoogleAuthorization(
          body.token,
          body.email,
        ),
      },
    };
  }

  @Get('google/callback')
  @ThrottleTeacherAccess()
  async googleCallback(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: TeacherLineCallbackDto,
    @Res() response: Response,
  ): Promise<void> {
    if (query.error || !query.code || !query.state) {
      response.redirect(this.service.buildResultUrl('FAILED', null));
      return;
    }
    try {
      response.redirect(await this.service.completeGoogleAuthorization(query.code, query.state));
    } catch {
      response.redirect(this.service.buildResultUrl('FAILED', null));
    }
  }

  @Post('invitation/resolve')
  @ThrottleTeacherAccess()
  async resolveInvitation(@Body() body: TeacherLineInvitationTokenDto) {
    return { success: true, data: await this.service.resolveInvitation(body.token) };
  }

  /** The proof token stays in the POST body, never browser history or access logs. */
  @Post('start')
  @ThrottleTeacherAccess()
  async start(@Body() body: StartTeacherLineAuthorizationDto) {
    return {
      success: true,
      data: { authorizationUrl: await this.service.startAuthorization(body.token) },
    };
  }

  @Get('callback')
  @ThrottleTeacherAccess()
  async callback(
    // LINE owns this URL and appends its own parameters, so an undeclared one
    // must be dropped rather than rejected: a 400 here replaces the redirect
    // with raw JSON for a teacher who already signed in successfully.
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: TeacherLineCallbackDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Consent declined at the LINE screen comes back without a code; that is a
    // normal user choice, not a failure to investigate.
    if (query.error || !query.code || !query.state) {
      response.redirect(this.service.buildResultUrl('FAILED', null));
      return;
    }
    const result = await this.service.completeAuthorization(
      query.code,
      query.state,
      request.ip ?? null,
    );
    response.redirect(this.service.buildResultUrl(result.outcome, result.addContactUrl));
  }
}

/**
 * Separate controller because the webhook URL registered in the LINE console is
 * `/api/line/webhook`, a sibling of the linking routes rather than a child.
 */
@Public()
@Controller('api/line')
export class TeacherLineWebhookController {
  constructor(private readonly service: TeacherLineService) {}

  /**
   * Not rate limited: LINE decides how often it delivers, retries what it thinks
   * failed, and disables a webhook that keeps erroring — throttling it would
   * silently drop friendship changes. The HMAC signature is the access control.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-line-signature') signature?: string,
  ) {
    await this.service.applyWebhookEvents(request.rawBody ?? '', signature ?? '');
    return { success: true };
  }
}

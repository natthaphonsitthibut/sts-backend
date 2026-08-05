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
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth';
import {
  ThrottleOtpRequest,
  ThrottleOtpVerify,
  ThrottleTeacherAccess,
} from '../config/throttle.decorators';
import {
  RequestTeacherLineOtpDto,
  StartTeacherLineAuthorizationDto,
  TeacherLineCallbackDto,
  VerifyTeacherLineOtpDto,
} from './dto/teacher-line.dto';
import { TeacherLineService } from './teacher-line.service';

/**
 * Public because a teacher linking their LINE account has no account to sign in
 * with — the emailed OTP is the authentication. Every route is rate limited, and
 * the OTP routes reuse the same limiters as every other one-time-code endpoint.
 *
 * The path is LINE-shaped on purpose: `code`/`state` are that provider's OAuth
 * contract, and the callback URL is registered character-for-character in the
 * LINE console, so it cannot be renamed without changing it there too.
 */
@Public()
@Controller('api/line/link')
export class TeacherLineController {
  constructor(private readonly service: TeacherLineService) {}

  /** Lets the page hide the whole flow when the integration is switched off. */
  @Get('status')
  status() {
    return { success: true, data: { enabled: this.service.isEnabled() } };
  }

  @Post('otp/request')
  @ThrottleOtpRequest()
  async requestOtp(@Body() body: RequestTeacherLineOtpDto, @Req() request: Request) {
    return {
      success: true,
      data: await this.service.requestOtp(body.email, request.ip ?? null),
    };
  }

  @Post('otp/verify')
  @ThrottleOtpVerify()
  async verifyOtp(@Body() body: VerifyTeacherLineOtpDto, @Req() request: Request) {
    return {
      success: true,
      data: await this.service.verifyOtp(body.email, body.code, request.ip ?? null),
    };
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

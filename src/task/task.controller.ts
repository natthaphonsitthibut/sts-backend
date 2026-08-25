import {
  Inject,
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Headers,
  Param,
  Query,
  Req,
  Res,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TaskService } from './task.service';
import type { Request, Response } from 'express';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { AuthGuard, CurrentUser, Public } from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { ThrottleIdentityStart, ThrottleIdentityVerify } from '../config/throttle.decorators';
import { DevelopmentGoogleLoginDto } from '../google-login/dto/development-google-login.dto';
import { CreateTaskDto, SaveTaskSubmissionDto, TaskGoogleCallbackDto } from './dto/task.dto';
import {
  getHeaderValue,
  getTaskErrorMessage,
  hasHttpStatusGetter,
  type RequestWithActor,
} from './task.types';

@Controller('api/tasks')
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
    private readonly araIdSessionCookie: AraIdSessionCookieService,
  ) {}

  private resolveStatusCode(err: unknown, fallbackStatus: HttpStatus): HttpStatus {
    if (hasHttpStatusGetter(err)) {
      return err.getStatus();
    }

    return fallbackStatus;
  }

  @UseGuards(AuthGuard)
  @Post()
  async createTask(@Body() body: CreateTaskDto, @Req() req: RequestWithActor) {
    try {
      const baseUrl = resolveExternalBaseUrl(req as Request, this.runtimeConfig.frontendBaseUrl);
      return await this.taskService.createTask(req.user, body, baseUrl);
    } catch (err) {
      throw new HttpException(
        getTaskErrorMessage(err),
        this.resolveStatusCode(err, HttpStatus.BAD_REQUEST),
      );
    }
  }

  @UseGuards(AuthGuard)
  @Get('visit-assignees/:studentId')
  async getVisitAssignees(@Param('studentId') studentId: string, @Req() req: RequestWithActor) {
    return { data: await this.taskService.getVisitAssignees(req.user, studentId) };
  }

  @Public()
  @Get(':token')
  async getTask(@Param('token') token: string, @Req() req: Request) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    const task = await this.taskService.getTaskByToken(token, sessionToken);
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    if (task.error && task.status === 'EXPIRED') {
      throw new HttpException({ error: task.error, status: 'EXPIRED' }, HttpStatus.GONE);
    }
    return task;
  }

  @Get(':taskId/chain')
  @UseGuards(AuthGuard)
  async getTaskChain(
    @Param('taskId') taskId: string,
    @CurrentUser() actor: RequestWithActor['user'],
  ) {
    const result = await this.taskService.getTaskChain(actor, taskId);
    if (!result) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Public()
  @Post(':token/submission')
  async saveTaskSubmission(
    @Param('token') token: string,
    @Body() body: SaveTaskSubmissionDto,
    @Req() req: Request,
  ) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    return await this.taskService.saveTaskSubmission(token, body, sessionToken);
  }

  @Public()
  @ThrottleIdentityStart()
  @Post(':token/google/start')
  async startGoogle(@Param('token') token: string) {
    return { success: true, data: await this.taskService.startGoogleAuthorization(token) };
  }

  @Public()
  @ThrottleIdentityVerify()
  @Post(':token/google/development')
  async developmentGoogle(@Param('token') token: string, @Body() body: DevelopmentGoogleLoginDto) {
    return {
      success: true,
      data: {
        sessionToken: await this.taskService.completeDevelopmentGoogleAuthorization(
          token,
          body.email,
        ),
      },
    };
  }

  @Public()
  @ThrottleIdentityVerify()
  @Get('google/callback')
  async googleCallback(
    @Query(new ValidationPipe({ transform: true, whitelist: true })) query: TaskGoogleCallbackDto,
    @Res() response: Response,
  ): Promise<void> {
    const redirect = new URL('/task/google-callback', this.runtimeConfig.frontendBaseUrl);
    if (query.error || !query.code || !query.state) {
      redirect.hash = 'error=google_login_failed';
      response.redirect(redirect.toString());
      return;
    }
    try {
      const sessionToken = await this.taskService.completeGoogleAuthorization(
        query.code,
        query.state,
      );
      redirect.hash = new URLSearchParams({ sessionToken }).toString();
    } catch {
      redirect.hash = 'error=google_login_failed';
    }
    response.redirect(redirect.toString());
  }

  /**
   * AraID verification for a follow-up/assistance link. Same QR → PIN → approve
   * shape as the teacher link; the challenge itself is scoped to `task-link` so
   * it can never be redeemed through another flow.
   */
  @Public()
  @ThrottleIdentityStart()
  @Post(':token/araid/challenge')
  async createAraIdChallenge(@Param('token') token: string, @Req() request: Request) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return await this.taskService.createAraIdChallenge(token, baseUrl);
  }

  @Public()
  @ThrottleIdentityStart()
  @Post('araid/challenge/begin')
  async beginAraIdChallenge(
    @Headers('x-task-araid-challenge') rawChallenge: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = await this.taskService.beginTaskAraIdChallenge(
      (rawChallenge ?? '').trim(),
      this.araIdSessionCookie.readTaskLinkAuthorization(request.headers.cookie) ?? undefined,
    );
    this.araIdSessionCookie.setTaskLinkAuthorization(
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
    const authorizationToken = this.araIdSessionCookie.readTaskLinkAuthorization(
      request.headers.cookie,
    );
    if (!authorizationToken) throw new UnauthorizedException('การยืนยัน AraID หมดอายุแล้ว');
    const result = await this.taskService.approveTaskAraIdChallenge(
      authorizationToken,
      session.profileId,
      session.authenticatedAt,
    );
    this.araIdSessionCookie.clearTaskLinkAuthorization(response);
    return result;
  }

  @Public()
  @ThrottleIdentityVerify()
  @Post('araid/challenge/status')
  async pollAraIdChallenge(@Headers('x-task-araid-challenge') rawChallenge: string | undefined) {
    return await this.taskService.pollTaskAraIdChallenge((rawChallenge ?? '').trim());
  }

  @Post(':taskId/delete')
  @Post('delete/:taskId')
  @Delete(':taskId')
  @UseGuards(AuthGuard)
  async deleteTask(@Param('taskId') taskId: string, @Req() req: RequestWithActor) {
    return await this.taskService.deleteTask(taskId, req.user, req.ip ?? null);
  }
}

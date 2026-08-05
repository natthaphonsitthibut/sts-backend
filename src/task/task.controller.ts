import {
  Inject,
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TaskService } from './task.service';
import type { Request } from 'express';
import { AuthGuard, CurrentUser, PermissionsGuard, Public, RequirePermission } from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { getBangkokDateString } from '../common/utils/date.util';
import { appConfig } from '../config/app.config';
import { ThrottleOtpRequest, ThrottleOtpVerify } from '../config/throttle.decorators';
import {
  CreateTaskDto,
  GetVisitLinksQueryDto,
  SaveTaskAttendanceDto,
  SaveTaskSubmissionDto,
} from './dto/task.dto';
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

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  @Get('visit-links')
  async getVisitLinks(@Req() req: RequestWithActor, @Query() query: GetVisitLinksQueryDto) {
    return await this.taskService.getVisitLinks(req.user, {
      status: query.status,
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      gradeLevelId: query.gradeLevelId,
      room: query.room?.trim() || undefined,
      page: query.page,
      limit: query.limit,
    });
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

  @Public()
  @Get(':token/students')
  async getTaskStudents(@Param('token') token: string) {
    return await this.taskService.getTaskStudents(token);
  }

  @Public()
  @Get(':token/history')
  async getTaskHistory(@Param('token') token: string, @Query('date') date: string) {
    const targetDate = date || getBangkokDateString();
    return await this.taskService.getTaskHistory(token, targetDate);
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
  @Post(':token/attendance')
  async saveTaskAttendance(
    @Param('token') token: string,
    @Body() body: SaveTaskAttendanceDto,
    @Req() req: Request,
  ) {
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);
    return await this.taskService.saveTaskAttendance(token, body, sessionToken);
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
  @ThrottleOtpRequest()
  @Post(':token/otp')
  async requestOtp(@Param('token') token: string) {
    return await this.taskService.requestOtp(token);
  }

  @Public()
  @ThrottleOtpVerify()
  @Post(':token/verify')
  async verifyOtp(@Param('token') token: string, @Body('otp') otp: string) {
    return await this.taskService.verifyOtp(token, otp);
  }

  @Post(':taskId/delete')
  @Post('delete/:taskId')
  @Delete(':taskId')
  @UseGuards(AuthGuard)
  async deleteTask(@Param('taskId') taskId: string, @Req() req: RequestWithActor) {
    return await this.taskService.deleteTask(taskId, req.user, req.ip ?? null);
  }
}

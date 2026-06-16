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
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { getBangkokDateString } from '../common/utils/date.util';
import { appConfig } from '../config/app.config';
import { CreateTaskDto, SaveTaskAttendanceDto, SaveTaskSubmissionDto } from './dto/task.dto';
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
  @RequirePermission('login-links')
  @Get('login-links')
  async getLoginLinks(@Req() req: RequestWithActor) {
    return await this.taskService.getLoginLinks(req.user);
  }

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

  @Get(':token/students')
  async getTaskStudents(@Param('token') token: string) {
    return await this.taskService.getTaskStudents(token);
  }

  @Get(':token/login-verify')
  async verifyMagicLogin(@Param('token') token: string, @Req() req: Request) {
    try {
      const sessionToken = getHeaderValue(req.headers['x-magic-session']);
      return await this.taskService.verifyMagicLogin(token, sessionToken);
    } catch (err) {
      throw new HttpException(getTaskErrorMessage(err), HttpStatus.UNAUTHORIZED);
    }
  }

  @Get(':token/history')
  async getTaskHistory(@Param('token') token: string, @Query('date') date: string) {
    const targetDate = date || getBangkokDateString();
    return await this.taskService.getTaskHistory(token, targetDate);
  }

  @Get(':taskId/chain')
  @UseGuards(AuthGuard)
  async getTaskChain(@Param('taskId') taskId: string) {
    const result = await this.taskService.getTaskChain(taskId);
    if (!result) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Post(':token/attendance')
  async saveTaskAttendance(@Param('token') token: string, @Body() body: SaveTaskAttendanceDto) {
    return await this.taskService.saveTaskAttendance(token, body.records);
  }

  @Post(':token/submission')
  async saveTaskSubmission(@Param('token') token: string, @Body() body: SaveTaskSubmissionDto) {
    return await this.taskService.saveTaskSubmission(token, body);
  }

  @Post(':token/otp')
  async requestOtp(@Param('token') token: string) {
    return await this.taskService.requestOtp(token);
  }

  @Post(':token/verify')
  async verifyOtp(@Param('token') token: string, @Body('otp') otp: string) {
    return await this.taskService.verifyOtp(token, otp);
  }

  @Post(':taskId/delete')
  @Post('delete/:taskId')
  @Delete(':taskId')
  @UseGuards(AuthGuard)
  async deleteTask(@Param('taskId') taskId: string) {
    return await this.taskService.deleteTask(taskId);
  }
}

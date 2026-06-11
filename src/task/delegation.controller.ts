import {
  Inject,
  Controller,
  Post,
  Body,
  Param,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DelegationService } from './delegation.service';
import type { Request } from 'express';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { DelegateTaskDto } from './dto/task.dto';
import { getTaskErrorMessage } from './task.types';

@Controller('api/tasks')
export class DelegationController {
  constructor(
    private readonly delegationService: DelegationService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  @Post(':token/delegate')
  async delegateTask(
    @Param('token') token: string,
    @Body() body: DelegateTaskDto,
    @Req() req: Request,
  ) {
    try {
      const baseUrl = resolveExternalBaseUrl(req, this.runtimeConfig.frontendBaseUrl);
      return await this.delegationService.delegateTask(token, body, baseUrl);
    } catch (err) {
      const message = getTaskErrorMessage(err);
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('expired')) {
        throw new HttpException(message, HttpStatus.GONE);
      }
      if (
        message.includes('no longer active') ||
        message.includes('disabled') ||
        message.includes('Max delegation')
      ) {
        throw new HttpException(message, HttpStatus.FORBIDDEN);
      }
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}

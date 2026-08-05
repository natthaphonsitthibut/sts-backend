import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  ParseIntPipe,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { CaseService } from './case.service';
import { OpenCaseDto, ReviewCaseDto } from './dto/task.dto';
import { getTaskErrorMessage, hasHttpStatusGetter } from './task.types';

@UseGuards(AuthGuard)
@Controller('api/cases')
export class CaseController {
  constructor(private readonly caseService: CaseService) {}

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  @Post()
  @HttpCode(HttpStatus.OK)
  async openCase(@Body() body: OpenCaseDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.caseService.openCase(body, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  @Get(':caseId')
  async getCase(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.caseService.getCase(caseId, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  @Post(':caseId/review')
  async reviewCase(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Body() body: ReviewCaseDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    try {
      return await this.caseService.reviewCase(caseId, body, actor);
    } catch (err) {
      if (hasHttpStatusGetter(err)) {
        throw err;
      }
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }

  @Get(':caseId/tasks')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  async getCaseTasks(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    try {
      return await this.caseService.getTasksByCase(caseId, actor);
    } catch (err) {
      if (hasHttpStatusGetter(err)) {
        throw err;
      }
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }

  @Get(':caseId/reviews')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  async getCaseReviews(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    try {
      return await this.caseService.getCaseReviews(caseId, actor);
    } catch (err) {
      if (hasHttpStatusGetter(err)) {
        throw err;
      }
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }
}

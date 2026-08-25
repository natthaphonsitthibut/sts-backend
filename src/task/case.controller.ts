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
import { CancelCaseAssignmentDto, OpenCaseDto, ReviewCaseDto } from './dto/task.dto';
import { getTaskErrorMessage, hasHttpStatusGetter } from './task.types';

@UseGuards(AuthGuard)
@Controller('api/cases')
export class CaseController {
  constructor(private readonly caseService: CaseService) {}

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('dashboard')
  @Post()
  @HttpCode(HttpStatus.OK)
  async openCase(@Body() body: OpenCaseDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.caseService.openCase(body, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('dashboard')
  @Get('referral-agencies')
  listReferralAgencies(@CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.caseService.listReferralAgencies(actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('dashboard')
  @Get(':caseId')
  async getCase(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.caseService.getCase(caseId, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('dashboard')
  @Post(':caseId/cancel-assignment')
  @HttpCode(HttpStatus.OK)
  async cancelCaseAssignment(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Body() body: CancelCaseAssignmentDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.caseService.cancelCaseAssignment(caseId, body, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('dashboard')
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
  @RequirePermission('dashboard')
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
  @RequirePermission('dashboard')
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

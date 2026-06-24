import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  ParseIntPipe,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
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
import { ReviewCaseDto, UpdateCaseReferralDto } from './dto/task.dto';
import { getTaskErrorMessage, hasHttpStatusGetter } from './task.types';

@UseGuards(AuthGuard)
@Controller('api/cases')
export class CaseController {
  constructor(private readonly caseService: CaseService) {}

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

  @Get(':caseId/referral-agencies')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases', 'forward-case')
  async getReferralAgencies(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    try {
      return await this.caseService.getReferralAgencies(caseId, actor);
    } catch (err) {
      if (hasHttpStatusGetter(err)) {
        throw err;
      }
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }

  @Get(':caseId/referrals')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  async getCaseReferrals(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    try {
      return await this.caseService.getCaseReferrals(caseId, actor);
    } catch (err) {
      if (hasHttpStatusGetter(err)) {
        throw err;
      }
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }

  @Patch(':caseId/referrals/:referralId')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases', 'forward-case')
  async updateCaseReferral(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Param('referralId', ParseUUIDPipe) referralId: string,
    @Body() body: UpdateCaseReferralDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    try {
      return await this.caseService.updateCaseReferralOutcome(caseId, referralId, body, actor);
    } catch (err) {
      if (hasHttpStatusGetter(err)) {
        throw err;
      }
      const message = getTaskErrorMessage(err);
      const status =
        message === 'Referral not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }
}

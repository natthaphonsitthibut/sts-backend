import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  ParseIntPipe,
  ParseUUIDPipe,
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
import { CaseRoundLineService } from './case-round-line.service';
import { CaseService } from './case.service';
import { ReferralLinkService } from './referral-link.service';
import {
  CancelCaseAssignmentDto,
  CancelReferralDto,
  CloseWatchDto,
  OpenCaseDto,
  SendReferralDto,
  ReviewCaseDto,
  SendRoundLineDto,
} from './dto/task.dto';
import { getTaskErrorMessage, hasHttpStatusGetter } from './task.types';

@UseGuards(AuthGuard)
@Controller('api/cases')
export class CaseController {
  constructor(
    private readonly caseService: CaseService,
    private readonly caseRoundLine: CaseRoundLineService,
    private readonly referralLinkService: ReferralLinkService,
  ) {}

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Post()
  @HttpCode(HttpStatus.OK)
  async openCase(@Body() body: OpenCaseDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.caseService.openCase(body, actor);
  }

  /** ปิดการเฝ้าระวัง — the เฝ้าระวัง student returns to ปกติ without a case. */
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Post('watch-closures')
  @HttpCode(HttpStatus.OK)
  async closeWatch(@Body() body: CloseWatchDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.caseService.closeWatch(body, actor);
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

  /** ส่งลิงก์ผ่าน LINE: one round's link, straight to its assigned teacher. */
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Post(':caseId/rounds/:taskId/send-line')
  @HttpCode(HttpStatus.OK)
  async sendRoundLine(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() body: SendRoundLineDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.caseRoundLine.send(caseId, taskId, body.deliveryRequestId, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
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
  @RequirePermission('case:manage')
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

  /**
   * ส่งต่อ, the referral's มอบหมาย: agency, reason and the link's window. The
   * agency's access code is also available to an authorized reviewer.
   */
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Post(':caseId/referrals')
  @Header('Cache-Control', 'private, no-store')
  async sendReferral(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Body() body: SendReferralDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.referralLinkService.sendReferral(caseId, body, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Get(':caseId/referrals/:referralId/access-code')
  @Header('Cache-Control', 'private, no-store')
  async getReferralAccessCode(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Param('referralId', new ParseUUIDPipe()) referralId: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.referralLinkService.getAccessCode(caseId, referralId, actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Post(':caseId/referrals/:referralId/access-code/refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  async refreshReferralAccessCode(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Param('referralId', new ParseUUIDPipe()) referralId: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.referralLinkService.refreshAccessCode(caseId, referralId, actor);
  }

  /** ยกเลิกการส่งต่อ, like ยกเลิกการมอบหมาย: back to รอส่งต่อ with a reason. */
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('case:manage')
  @Post(':caseId/referrals/:referralId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelReferral(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Param('referralId', new ParseUUIDPipe()) referralId: string,
    @Body() body: CancelReferralDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.referralLinkService.cancelReferral(caseId, referralId, body, actor);
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

import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isRestrictedExecutive } from '../auth/permissions.constants';
import { hashToken } from '../common/utils/helpers';
import type { CreateTaskDto, SaveTaskSubmissionDto } from './dto/task.dto';
import { TaskAccessService } from './task-access.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskReadService } from './task-read.service';
import { TaskRepository } from './task.repository';
import { TaskStatsService } from './task-stats.service';
import { TaskSubmissionService } from './task-submission.service';
import type { CaseListFilters, LoginLinkListFilters } from './task.repository';
import type { ActorContext, RiskDashboardFilters } from './task.types';

@Injectable()
export class TaskService {
  constructor(
    private readonly taskLifecycleService: TaskLifecycleService,
    private readonly taskAccessService: TaskAccessService,
    private readonly taskReadService: TaskReadService,
    private readonly taskSubmissionService: TaskSubmissionService,
    private readonly taskStatsService: TaskStatsService,
    private readonly taskRepository: TaskRepository,
  ) {}

  private async assertOtpLinkUsable(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const link = await this.taskRepository.findTaskLinkByTokenHash(tokenHash);

    if (!link) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }

    if (new Date(String(link.expires_at)) < new Date()) {
      throw new GoneException('ลิงก์หมดอายุ');
    }

    if (link.admin_locked === true || Number(link.admin_locked) === 1) {
      throw new ForbiddenException('ลิงก์นี้ถูกปิดโดยผู้ดูแลระบบ');
    }

    if (link.opens_at && new Date(link.opens_at as string) > new Date()) {
      throw new ForbiddenException('ลิงก์นี้ยังไม่เปิดใช้งาน');
    }

    if (link.status !== 'ACTIVE') {
      throw new ConflictException('ลิงก์นี้ไม่อยู่ในสถานะพร้อมใช้งาน');
    }
  }

  async createTask(actor: ActorContext | undefined, data: CreateTaskDto, baseUrl: string) {
    return await this.taskLifecycleService.createTask(actor, data, baseUrl);
  }

  async getVisitAssignees(actor: ActorContext | undefined, studentUuid: string) {
    return await this.taskLifecycleService.listVisitAssignees(actor, studentUuid);
  }

  async assertVisitSubmissionAccess(token: string, sessionToken?: string): Promise<void> {
    await this.taskSubmissionService.assertVisitSubmissionAccess(token, sessionToken);
  }

  async getTaskByToken(token: string, sessionToken?: string) {
    const result = await this.taskAccessService.getTaskByToken(token, sessionToken);
    if (!result || typeof result !== 'object') {
      return result;
    }
    // The public token endpoint must not expose the link's access config to the
    // guest holding the token. These fields are consumed only internally by the
    // login-verify flow (verifyMagicLogin reads the unsanitized access-service
    // result directly), so strip them from the HTTP-facing response.
    const {
      assigned_to_email,
      login_role,
      login_permissions,
      login_data_scope,
      otp_verified,
      ...safe
    } = result;
    void assigned_to_email;
    void login_role;
    void login_permissions;
    void login_data_scope;
    void otp_verified;
    return safe;
  }

  async verifyMagicLogin(token: string, sessionToken?: string) {
    return await this.taskAccessService.verifyMagicLogin(token, sessionToken);
  }

  async getLoginLinks(actor?: ActorContext, filters: Partial<LoginLinkListFilters> = {}) {
    return await this.taskAccessService.getLoginLinks(actor, filters);
  }

  async findCaseForActor(caseId: number, actor?: ActorContext) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    return await this.taskRepository.findCaseById(caseId, undefined, actor);
  }

  async deleteTask(taskId: string, actor?: ActorContext, ip?: string | null) {
    return await this.taskLifecycleService.deleteTask(taskId, actor, ip);
  }

  async getTaskChain(actor: ActorContext | undefined, taskId: string) {
    return await this.taskReadService.getTaskChain(actor, taskId);
  }

  async saveTaskSubmission(token: string, data: SaveTaskSubmissionDto, sessionToken?: string) {
    return await this.taskSubmissionService.saveTaskSubmission(token, data, sessionToken);
  }

  async requestOtp(token: string) {
    await this.assertOtpLinkUsable(token);
    return await this.taskAccessService.requestOtp(token);
  }

  async verifyOtp(token: string, otp: string) {
    await this.assertOtpLinkUsable(token);
    return await this.taskAccessService.verifyOtp(token, otp);
  }

  async createAraIdChallenge(token: string, baseUrl: string) {
    return await this.taskAccessService.createAraIdChallenge(token, baseUrl);
  }

  async beginTaskAraIdChallenge(challengeToken: string, existingAuthorizationToken?: string) {
    return await this.taskAccessService.beginTaskAraIdChallenge(
      challengeToken,
      existingAuthorizationToken,
    );
  }

  async approveTaskAraIdChallenge(
    authorizationToken: string,
    araIdProfileId: string,
    authenticatedAt: number,
  ) {
    return await this.taskAccessService.approveTaskAraIdChallenge(
      authorizationToken,
      araIdProfileId,
      authenticatedAt,
    );
  }

  async pollTaskAraIdChallenge(challengeToken: string) {
    return await this.taskAccessService.pollTaskAraIdChallenge(challengeToken);
  }

  async adminLockLink(
    actor: ActorContext | undefined,
    linkId: string,
    action: 'lock' | 'unlock',
    reason?: string,
  ) {
    return await this.taskAccessService.adminLockLink(actor, linkId, action, reason);
  }

  async getAdminLinkDetail(actor: ActorContext | undefined, linkId: string) {
    return await this.taskAccessService.getAdminLinkDetail(actor, linkId);
  }

  async getCases(actor?: ActorContext, filters: CaseListFilters = {}) {
    return await this.taskStatsService.getCases(actor, filters);
  }

  async getStats(actor?: ActorContext) {
    return await this.taskStatsService.getStats(actor);
  }

  async getOverviewStats(actor?: ActorContext) {
    return await this.taskStatsService.getOverviewStats(actor);
  }

  async getRiskDashboard(actor?: ActorContext, filters: RiskDashboardFilters = {}) {
    return await this.taskStatsService.getRiskDashboard(actor, filters);
  }
}

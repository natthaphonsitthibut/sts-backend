import { ForbiddenException, Injectable } from '@nestjs/common';
import { isRestrictedExecutive } from '../auth/permissions.constants';
import type { CreateTaskDto, SaveTaskSubmissionDto } from './dto/task.dto';
import { TaskAccessService } from './task-access.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskReadService } from './task-read.service';
import { TaskRepository } from './task.repository';
import { TaskStatsService } from './task-stats.service';
import { TaskSubmissionService } from './task-submission.service';
import type { CaseListFilters } from './task.repository';
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
    const { assigned_to_email, login_role, login_permissions, login_data_scope, ...safe } = result;
    void assigned_to_email;
    void login_role;
    void login_permissions;
    void login_data_scope;
    return safe;
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

  async startGoogleAuthorization(token: string) {
    return await this.taskAccessService.startGoogleAuthorization(token);
  }

  async completeGoogleAuthorization(code: string, state: string): Promise<string> {
    return await this.taskAccessService.completeGoogleAuthorization(code, state);
  }

  async completeDevelopmentGoogleAuthorization(token: string, email: string): Promise<string> {
    return await this.taskAccessService.completeDevelopmentGoogleAuthorization(token, email);
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

  async getFollowUpSummary(actor?: ActorContext) {
    return await this.taskStatsService.getFollowUpSummary(actor);
  }

  async getReferralDrilldown(actor?: ActorContext, page?: number, limit?: number) {
    return await this.taskStatsService.getReferralDrilldown(actor, page, limit);
  }

  async getRiskDashboard(actor?: ActorContext, filters: RiskDashboardFilters = {}) {
    return await this.taskStatsService.getRiskDashboard(actor, filters);
  }
}

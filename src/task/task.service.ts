import { Injectable } from '@nestjs/common';
import type { CreateTaskDto, SaveTaskAttendanceDto, SaveTaskSubmissionDto } from './dto/task.dto';
import { TaskAccessService } from './task-access.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskReadService } from './task-read.service';
import { TaskStatsService } from './task-stats.service';
import { TaskSubmissionService } from './task-submission.service';
import type { ActorContext } from './task.types';

@Injectable()
export class TaskService {
  constructor(
    private readonly taskLifecycleService: TaskLifecycleService,
    private readonly taskAccessService: TaskAccessService,
    private readonly taskReadService: TaskReadService,
    private readonly taskSubmissionService: TaskSubmissionService,
    private readonly taskStatsService: TaskStatsService,
  ) {}

  async createTask(actor: ActorContext | undefined, data: CreateTaskDto, baseUrl: string) {
    return await this.taskLifecycleService.createTask(actor, data, baseUrl);
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
    const { login_role, login_permissions, login_data_scope, otp_verified, ...safe } = result;
    void login_role;
    void login_permissions;
    void login_data_scope;
    void otp_verified;
    return safe;
  }

  async verifyMagicLogin(token: string, sessionToken?: string) {
    return await this.taskAccessService.verifyMagicLogin(token, sessionToken);
  }

  async getLoginLinks(actor?: ActorContext) {
    return await this.taskAccessService.getLoginLinks(actor);
  }

  async deleteTask(taskId: string) {
    return await this.taskLifecycleService.deleteTask(taskId);
  }

  async getTaskStudents(token: string) {
    return await this.taskReadService.getTaskStudents(token);
  }

  async getTaskHistory(token: string, date: string) {
    return await this.taskReadService.getTaskHistory(token, date);
  }

  async getTaskChain(taskId: string) {
    return await this.taskReadService.getTaskChain(taskId);
  }

  async saveTaskAttendance(token: string, records: SaveTaskAttendanceDto['records']) {
    return await this.taskSubmissionService.saveTaskAttendance(token, records);
  }

  async saveTaskSubmission(token: string, data: SaveTaskSubmissionDto) {
    return await this.taskSubmissionService.saveTaskSubmission(token, data);
  }

  async requestOtp(token: string) {
    return await this.taskAccessService.requestOtp(token);
  }

  async verifyOtp(token: string, otp: string) {
    return await this.taskAccessService.verifyOtp(token, otp);
  }

  async adminLockLink(
    actor: ActorContext | undefined,
    linkId: string,
    action: 'lock' | 'unlock',
    reason?: string,
  ) {
    return await this.taskAccessService.adminLockLink(actor, linkId, action, reason);
  }

  async getAdminLinkDetail(actor: ActorContext | undefined, linkId: string, date?: string) {
    return await this.taskAccessService.getAdminLinkDetail(actor, linkId, date);
  }

  async getCases() {
    return await this.taskStatsService.getCases();
  }

  async getStats() {
    return await this.taskStatsService.getStats();
  }

  async getOverviewStats() {
    return await this.taskStatsService.getOverviewStats();
  }
}

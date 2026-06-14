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
    return await this.taskAccessService.getTaskByToken(token, sessionToken);
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

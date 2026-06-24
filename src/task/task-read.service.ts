import { Injectable, Logger } from '@nestjs/common';
import { TaskAccessService } from './task-access.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import type { ActorContext } from './task.types';

@Injectable()
export class TaskReadService {
  private readonly logger = new Logger(TaskReadService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskAccessService: TaskAccessService,
    private readonly taskPolicyService: TaskPolicyService,
  ) {}

  async getTaskStudents(token: string) {
    try {
      const task = await this.taskAccessService.getTaskByToken(token);
      if (!task || task.status === 'EXPIRED') {
        throw new Error('Task not found or expired');
      }

      const rows = await this.taskRepository.listTaskStudents({
        targetGrade: typeof task.target_grade === 'string' ? task.target_grade : null,
        targetRoom: typeof task.target_room === 'string' ? task.target_room : null,
        targetSchoolId:
          typeof task.target_school_id === 'number'
            ? task.target_school_id
            : typeof task.target_school_id === 'string' && task.target_school_id.trim().length > 0
              ? Number.parseInt(task.target_school_id, 10)
              : null,
      });

      return { success: true, data: rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getTaskStudents error: ${message}`);
      throw err;
    }
  }

  async getTaskHistory(token: string, date: string) {
    try {
      const task = await this.taskAccessService.getTaskByToken(token);
      if (!task || task.status === 'EXPIRED') {
        throw new Error('Task not found or expired');
      }

      const rows = await this.taskRepository.listTaskHistory(
        date,
        typeof task.target_grade === 'string' ? task.target_grade : null,
        typeof task.target_room === 'string' ? task.target_room : null,
        typeof task.target_school_id === 'number'
          ? task.target_school_id
          : typeof task.target_school_id === 'string' && task.target_school_id.trim().length > 0
            ? Number.parseInt(task.target_school_id, 10)
            : null,
      );

      return { success: true, data: rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getTaskHistory error: ${message}`);
      throw err;
    }
  }

  async getTaskChain(actor: ActorContext | undefined, taskId: string) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    try {
      const task = await this.taskRepository.findTaskChainTask(taskId, currentActor);
      if (!task) {
        return null;
      }

      const links = await this.taskRepository.listTaskLinksByTaskId(taskId);
      const chain = await Promise.all(
        links.map(async (link) => {
          const submission = await this.taskRepository.findTaskSubmissionByLinkId(String(link.id));
          return { ...link, submission };
        }),
      );

      const reviews =
        typeof task.case_id === 'number'
          ? await this.taskRepository.listCaseReviews(task.case_id)
          : [];
      const referrals =
        typeof task.case_id === 'number'
          ? await this.taskRepository.listCaseReferrals(task.case_id)
          : [];

      return {
        task_id: task.id,
        case_id: task.case_id,
        task_type: task.task_type,
        target_grade: task.target_grade,
        target_room: task.target_room,
        student_name: task.student_name,
        student_first_name: task.student_first_name,
        student_last_name: task.student_last_name,
        student_school: task.student_school,
        student_address: task.student_address,
        address_line: task.address_line,
        address_province: task.address_province,
        address_district: task.address_district,
        address_sub_district: task.address_sub_district,
        postal_code: task.postal_code,
        reason_flagged: task.reason_flagged,
        task_status: task.status,
        case_status: task.case_status,
        result_summary: task.result_summary,
        chain,
        reviews,
        referrals,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getTaskChain error: ${message}`);
      throw err;
    }
  }
}

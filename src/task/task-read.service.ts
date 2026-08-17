import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { isRestrictedExecutive } from '../auth/permissions.constants';
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

  async getTaskChain(actor: ActorContext | undefined, taskId: string) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
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
      return {
        task_id: task.id,
        case_id: task.case_id,
        task_type: task.task_type,
        target_grade: task.resolved_target_grade ?? task.target_grade,
        target_room: task.resolved_target_room ?? task.target_room,
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
        completion_outcome_code: task.completion_outcome_code,
        display_status_label: task.display_status_label,
        result_summary: task.result_summary,
        chain,
        reviews,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getTaskChain error: ${message}`);
      throw err;
    }
  }
}

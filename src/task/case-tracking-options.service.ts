import { BadRequestException, Injectable } from '@nestjs/common';
import { TaskRepository } from './task.repository';

export interface CaseTrackingOption {
  code: string;
  label: string;
  targetStatus: string | null;
  requiresResolutionOutcome: boolean;
}

interface CaseReviewActionPolicy extends CaseTrackingOption {
  requiredPermission: string;
}

@Injectable()
export class CaseTrackingOptionsService {
  constructor(private readonly taskRepository: TaskRepository) {}

  private stringValue(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  private mapOption(row: Record<string, unknown>): CaseTrackingOption {
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
      targetStatus:
        typeof row.target_case_status_code === 'string' ? row.target_case_status_code : null,
      requiresResolutionOutcome: row.requires_resolution_outcome === true,
    };
  }

  async getOptions() {
    const [reviewActions, followUpDecisions, resolutionOutcomes] = await Promise.all([
      this.taskRepository.listCaseReviewActions(),
      this.taskRepository.listCaseFollowUpDecisions(),
      this.taskRepository.listCaseResolutionOutcomes(),
    ]);
    return {
      reviewActions: reviewActions.map((row) => ({
        ...this.mapOption(row),
        requiredPermission: this.stringValue(row.required_permission_code),
      })),
      followUpDecisions: followUpDecisions.map((row) => this.mapOption(row)),
      resolutionOutcomes: resolutionOutcomes.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
      })),
    };
  }

  async getReviewAction(code: string): Promise<CaseReviewActionPolicy> {
    const row = await this.taskRepository.findCaseReviewAction(code);
    if (!row) throw new BadRequestException('การดำเนินการกับเคสไม่ถูกต้อง');
    return {
      ...this.mapOption(row),
      requiredPermission: this.stringValue(row.required_permission_code),
    };
  }

  async getFollowUpDecision(code: string): Promise<CaseTrackingOption> {
    const row = await this.taskRepository.findCaseFollowUpDecision(code);
    if (!row) throw new BadRequestException('ผลการส่งรายงานไม่ถูกต้อง');
    return this.mapOption(row);
  }

  async assertResolutionOutcome(code: string | null): Promise<string | null> {
    if (!code) return null;
    const row = await this.taskRepository.findCaseResolutionOutcome(code);
    if (!row) throw new BadRequestException('ผลลัพธ์การติดตามไม่ถูกต้อง');
    return this.stringValue(row.code);
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { TaskRepository } from './task.repository';

export interface CaseTrackingOption {
  code: string;
  label: string;
  targetStatus: string | null;
  requiresResolutionOutcome: boolean;
  completionOutcomeCode: string | null;
  /** null = offered in every workflow phase. */
  availablePhaseCode: string | null;
  targetWorkflowPhaseCode: string | null;
}

export interface AssistanceMeasureOption {
  code: string;
  label: string;
  requiresDetail: boolean;
}

interface CaseReviewActionPolicy extends CaseTrackingOption {
  requiredPermission: string;
}

export interface HomeVisitExceptionOption {
  code: string;
  label: string;
  requiresUpdatedAddress: boolean;
}

export interface FollowUpProblemCategoryOption {
  code: string;
  label: string;
  guidance: string | null;
}

export interface ParentalStatusOption {
  code: string;
  label: string;
}

export interface GuardianTypeOption {
  code: string;
  label: string;
  requiresDetail: boolean;
}

export interface ResidenceEnvironmentOption {
  code: string;
  label: string;
  /** `ปกติ / ไม่มีปัจจัยเสี่ยง` cannot be combined with any risk factor. */
  isExclusive: boolean;
  requiresDetail: boolean;
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
      completionOutcomeCode:
        typeof row.completion_outcome_code === 'string' ? row.completion_outcome_code : null,
      availablePhaseCode:
        typeof row.available_phase_code === 'string' ? row.available_phase_code : null,
      targetWorkflowPhaseCode:
        typeof row.target_workflow_phase_code === 'string' ? row.target_workflow_phase_code : null,
    };
  }

  private mapAssistanceMeasure(row: Record<string, unknown>): AssistanceMeasureOption {
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
      requiresDetail: row.requires_detail === true,
    };
  }

  async getOptions(phaseCode?: string | null) {
    const [
      reviewActions,
      followUpDecisions,
      resolutionOutcomes,
      homeVisitExceptions,
      followUpProblemCategories,
      parentalStatuses,
      guardianTypes,
      residenceEnvironments,
      assistanceMeasures,
      executionOutcomes,
      nonFollowUpReasons,
      absenceReasons,
      disadvantageTypes,
      disabilityTypes,
      contactChannels,
    ] = await Promise.all([
      this.taskRepository.listCaseReviewActions(phaseCode ?? null),
      this.taskRepository.listCaseFollowUpDecisions(),
      this.taskRepository.listCaseResolutionOutcomes(),
      this.taskRepository.listHomeVisitExceptionOptions(),
      this.taskRepository.listFollowUpProblemCategoryOptions(),
      this.taskRepository.listParentalStatusOptions(),
      this.taskRepository.listGuardianTypeOptions(),
      this.taskRepository.listResidenceEnvironmentOptions(),
      this.taskRepository.listAssistanceMeasures(),
      this.taskRepository.listTaskExecutionOutcomes(),
      this.taskRepository.listNonFollowUpReasons(),
      this.taskRepository.listAbsenceReasons(),
      this.taskRepository.listDisadvantageTypes(),
      this.taskRepository.listDisabilityTypes(),
      this.taskRepository.listContactChannelOptions(),
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
      homeVisitExceptions: homeVisitExceptions.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
        requiresUpdatedAddress: row.requires_updated_address === true,
      })),
      followUpProblemCategories: followUpProblemCategories.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
        guidance: typeof row.guidance_th === 'string' ? row.guidance_th : null,
      })),
      parentalStatuses: parentalStatuses.map((row) => this.mapParentalStatus(row)),
      guardianTypes: guardianTypes.map((row) => this.mapGuardianType(row)),
      residenceEnvironments: residenceEnvironments.map((row) => this.mapResidenceEnvironment(row)),
      assistanceMeasures: assistanceMeasures.map((row) => this.mapAssistanceMeasure(row)),
      executionOutcomes: executionOutcomes.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
        // A follow-up round found the student or did not; only assistance
        // succeeds or fails, so each flow asks in its own words.
        visitLabel: this.stringValue(row.visit_label_th) || this.stringValue(row.label_th),
      })),
      nonFollowUpReasons: nonFollowUpReasons.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
      })),
      absenceReasons: absenceReasons.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
        categoryCode: this.stringValue(row.category_code) || null,
        categoryLabel: this.stringValue(row.category_label_th) || null,
      })),
      disadvantageTypes: disadvantageTypes.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
      })),
      disabilityTypes: disabilityTypes.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
      })),
      contactChannels: contactChannels.map((row) => ({
        code: this.stringValue(row.code),
        label: this.stringValue(row.label_th),
      })),
    };
  }

  /**
   * Resolves the measures picked when an assistance round is assigned and
   * enforces the `requires_detail` rule that lives in the option table.
   */
  async getAssistanceMeasures(
    codes: string[],
    detail: string | null,
  ): Promise<AssistanceMeasureOption[]> {
    const unique = Array.from(new Set(codes.filter((code) => code.length > 0)));
    if (unique.length === 0) {
      throw new BadRequestException('กรุณาเลือกมาตรการการช่วยเหลืออย่างน้อยหนึ่งอย่าง');
    }
    const rows = await this.taskRepository.findAssistanceMeasures(unique);
    if (rows.length !== unique.length) {
      throw new BadRequestException('มาตรการการช่วยเหลือไม่ถูกต้อง');
    }
    const options = rows.map((row) => this.mapAssistanceMeasure(row));
    if (options.some((option) => option.requiresDetail) && !detail) {
      throw new BadRequestException('กรุณาระบุรายละเอียดมาตรการการช่วยเหลือ');
    }
    return options;
  }

  private mapParentalStatus(row: Record<string, unknown>): ParentalStatusOption {
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
    };
  }

  private mapGuardianType(row: Record<string, unknown>): GuardianTypeOption {
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
      requiresDetail: row.requires_detail === true,
    };
  }

  private mapResidenceEnvironment(row: Record<string, unknown>): ResidenceEnvironmentOption {
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
      isExclusive: row.is_exclusive === true,
      requiresDetail: row.requires_detail === true,
    };
  }

  async getParentalStatus(code: string | null): Promise<ParentalStatusOption | null> {
    if (!code) return null;
    const row = await this.taskRepository.findParentalStatusOption(code);
    if (!row) throw new BadRequestException('สถานะของบิดา-มารดาไม่ถูกต้อง');
    return this.mapParentalStatus(row);
  }

  async getGuardianType(code: string | null): Promise<GuardianTypeOption | null> {
    if (!code) return null;
    const row = await this.taskRepository.findGuardianTypeOption(code);
    if (!row) throw new BadRequestException('ผู้ปกครองไม่ถูกต้อง');
    return this.mapGuardianType(row);
  }

  /**
   * Resolves the picked environment codes and enforces the two rules that live
   * in the option table itself: an exclusive answer (`ปกติ / ไม่มีปัจจัยเสี่ยง`)
   * cannot be mixed with risk factors, and an option flagged `requires_detail`
   * needs the free-text description filled in.
   */
  async getResidenceEnvironments(
    codes: string[],
    detail: string | null,
  ): Promise<ResidenceEnvironmentOption[]> {
    const unique = Array.from(new Set(codes.filter((code) => code.length > 0)));
    if (unique.length === 0) return [];
    const rows = await this.taskRepository.findResidenceEnvironmentOptions(unique);
    if (rows.length !== unique.length) {
      throw new BadRequestException('สภาพแวดล้อมรอบที่พักไม่ถูกต้อง');
    }
    const options = rows.map((row) => this.mapResidenceEnvironment(row));
    if (options.length > 1 && options.some((option) => option.isExclusive)) {
      throw new BadRequestException('เลือกสภาพแวดล้อมแบบปกติร่วมกับปัจจัยเสี่ยงอื่นไม่ได้');
    }
    if (options.some((option) => option.requiresDetail) && !detail) {
      throw new BadRequestException('กรุณาระบุรายละเอียดสภาพแวดล้อมรอบที่พัก');
    }
    return options;
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

  async getTaskExecutionOutcome(code: string | null): Promise<string> {
    if (!code) throw new BadRequestException('กรุณาเลือกผลการดำเนินงานครั้งนี้');
    const row = await this.taskRepository.findTaskExecutionOutcome(code);
    if (!row) throw new BadRequestException('ผลการดำเนินงานไม่ถูกต้อง');
    return this.stringValue(row.code);
  }

  async getContactChannel(code: string | null): Promise<string | null> {
    if (!code) return null;
    const row = await this.taskRepository.findContactChannelOption(code);
    if (!row) throw new BadRequestException('ช่องทางติดต่อไม่ถูกต้อง');
    return this.stringValue(row.code);
  }

  async getNonFollowUpReason(code: string | null): Promise<string | null> {
    if (!code) return null;
    const row = await this.taskRepository.findNonFollowUpReason(code);
    if (!row) throw new BadRequestException('สาเหตุการไม่ติดตามไม่ถูกต้อง');
    return this.stringValue(row.code);
  }

  async getAbsenceReason(code: string | null): Promise<string | null> {
    if (!code) return null;
    const row = await this.taskRepository.findAbsenceReason(code);
    if (!row) throw new BadRequestException('สาเหตุการขาดไม่ถูกต้องหรือถูกปิดใช้งาน');
    return this.stringValue(row.code);
  }

  async getCareObservationCodes(
    kind: 'DISADVANTAGE' | 'DISABILITY',
    codes: string[],
  ): Promise<string[]> {
    const unique = Array.from(
      new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean)),
    );
    if (unique.length === 0) return [];
    const rows =
      kind === 'DISADVANTAGE'
        ? await this.taskRepository.findDisadvantageTypes(unique)
        : await this.taskRepository.findDisabilityTypes(unique);
    if (rows.length !== unique.length || rows.some((row) => row.code === 'NONE')) {
      throw new BadRequestException('ข้อมูลที่ควรคำนึงในการดูแลไม่ถูกต้อง');
    }
    return unique;
  }

  async getHomeVisitException(code: string | null): Promise<HomeVisitExceptionOption | null> {
    if (!code) return null;
    const row = await this.taskRepository.findHomeVisitExceptionOption(code);
    if (!row) throw new BadRequestException('กรณีพิเศษจากการลงพื้นที่ไม่ถูกต้อง');
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
      requiresUpdatedAddress: row.requires_updated_address === true,
    };
  }

  async getFollowUpProblemCategory(
    code: string | null,
  ): Promise<FollowUpProblemCategoryOption | null> {
    if (!code) return null;
    const row = await this.taskRepository.findFollowUpProblemCategoryOption(code);
    if (!row) throw new BadRequestException('หัวข้อปัญหาของผลการติดตามไม่ถูกต้อง');
    return {
      code: this.stringValue(row.code),
      label: this.stringValue(row.label_th),
      guidance: typeof row.guidance_th === 'string' ? row.guidance_th : null,
    };
  }
}

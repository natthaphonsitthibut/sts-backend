import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { isRestrictedExecutive } from '../auth/permissions.constants';
import { getBangkokDateString } from '../common/utils/date.util';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository, type CaseListFilters } from './task.repository';
import type {
  ActorContext,
  RiskDashboardFilters,
  RiskDashboardThresholds,
  RiskDashboardTier,
} from './task.types';

const DEFAULT_RISK_DASHBOARD_THRESHOLDS: RiskDashboardThresholds = {
  highAbsentDays: 3,
};

@Injectable()
export class TaskStatsService {
  private readonly logger = new Logger(TaskStatsService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
  ) {}

  async getCases(actor?: ActorContext, filters: CaseListFilters = {}) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    try {
      const page = resolvePage(filters.page);
      const limit = resolveLimit(filters.limit);
      const { rows, totalCount, statusCounts } = await this.taskRepository.listCasesWithActiveLinks(
        currentActor,
        { ...filters, page, limit },
      );

      return {
        success: true,
        data: rows,
        meta: {
          ...buildPaginationMeta(page, limit, totalCount),
          statusCounts,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getCases error: ${message}`);
      throw err;
    }
  }

  async getStats(actor?: ActorContext) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    try {
      const today = getBangkokDateString();

      const statusCounts = await this.taskRepository.countCaseStatuses(currentActor);
      return {
        total: await this.taskRepository.countCases(undefined, currentActor),
        atRiskStudents: await this.taskRepository.countAtRiskStudents(currentActor),
        open: await this.taskRepository.countCases('OPEN', currentActor),
        inProgress: await this.taskRepository.countCases('IN_PROGRESS', currentActor),
        resolved: await this.taskRepository.countCases('RESOLVED', currentActor),
        today: await this.taskRepository.countCasesCreatedOn(today, currentActor),
        pendingReview: await this.taskRepository.countCases('PENDING_REVIEW', currentActor),
        activeLinks: await this.taskRepository.countActiveTaskLinks(currentActor),
        delegations: 0,
        statusCounts,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getStats error: ${message}`);
      throw err;
    }
  }

  async getOverviewStats(actor?: ActorContext) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    try {
      return {
        success: true,
        data: {
          totalStudents: await this.taskRepository.countStudents(currentActor),
          activeCases: await this.taskRepository.countActiveCases(currentActor),
          atRiskStudents: await this.taskRepository.countAtRiskStudents(currentActor),
          caseTrackingStats: {
            waiting: await this.taskRepository.countCases('OPEN', currentActor),
            inProgress: await this.taskRepository.countCases('IN_PROGRESS', currentActor),
            resolved: await this.taskRepository.countCases('RESOLVED', currentActor),
          },
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getOverviewStats error: ${message}`);
      throw err;
    }
  }

  private parsePositiveInteger(value: string | null, fallback: number): number {
    const parsed = value ? Number.parseInt(value, 10) : fallback;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async getRiskDashboardThresholds(): Promise<RiskDashboardThresholds> {
    const highAbsentDays = await this.taskRepository.getSystemSettingValue(
      'CASE_RISK_HIGH_ABSENCE_DAYS',
    );
    return {
      highAbsentDays: this.parsePositiveInteger(
        highAbsentDays,
        DEFAULT_RISK_DASHBOARD_THRESHOLDS.highAbsentDays,
      ),
    };
  }

  private normalizeRiskTier(value?: string): RiskDashboardTier | undefined {
    if (value === 'HIGH' || value === 'WATCH' || value === 'NORMAL') {
      return value;
    }
    return undefined;
  }

  async getRiskDashboard(actor?: ActorContext, filters: RiskDashboardFilters = {}) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    try {
      const page = resolvePage(filters.page);
      const limit = resolveLimit(filters.limit);
      const thresholds = await this.getRiskDashboardThresholds();
      const { rows, totalCount, summary, caseStatusSummary, missingProfileCount } =
        await this.taskRepository.listRiskDashboardStudents(
          currentActor,
          {
            ...filters,
            riskTier: this.normalizeRiskTier(filters.riskTier),
            page,
            limit,
            sortBy: filters.sortBy ?? 'risk',
            sortDirection: filters.sortDirection ?? 'desc',
          },
          thresholds,
        );
      const canViewTeacherComments = currentActor.permissions.includes(
        'manage-student-observations',
      );
      if (missingProfileCount && missingProfileCount > 0) {
        this.logger.warn(
          `Risk dashboard has ${missingProfileCount} active enrollment(s) without risk profiles`,
        );
      }

      return {
        success: true,
        data: rows.map((row) => ({
          studentId: row.student_uuid,
          studentName: row.student_name,
          studentPhotoUrl: row.photo_storage_key
            ? `/api/students/${encodeURIComponent(row.student_uuid)}/photo?v=${encodeMediaVersion(row.photo_updated_at)}`
            : null,
          schoolId: row.school_id,
          schoolName: row.school_name,
          grade: row.grade,
          room: row.room,
          consecutiveAbsentDays: Number(row.consecutive_absent_days ?? 0),
          absentDays: Number(row.absent_days ?? 0),
          termAbsentDays: Number(row.term_absent_days ?? 0),
          absenceResetAfterDate: row.absence_reset_after_date ?? null,
          lateCount: Number(row.late_count ?? 0),
          subjectLateCount: Number(row.subject_late_count ?? 0),
          schoolDayCount: Number(row.school_day_count ?? 0),
          weightedAbsenceDays: Number(row.weighted_absence_days ?? 0),
          weightedAttendancePercent:
            row.weighted_attendance_percent === null
              ? null
              : Number(row.weighted_attendance_percent),
          riskTier: row.risk_tier,
          riskScore: Number(row.risk_score ?? 0),
          openCaseCount: Number(row.open_case_count ?? 0),
          latestOpenCaseId:
            row.latest_open_case_id == null ? null : Number(row.latest_open_case_id),
          latestOpenCaseReason: row.latest_open_case_reason ?? null,
          latestOpenTaskId: row.latest_open_task_id ?? null,
          latestCaseId: row.latest_case_id == null ? null : Number(row.latest_case_id),
          latestCaseStatus: row.latest_case_status ?? null,
          latestCaseAt: row.latest_case_at,
          latestCaseMagicLink: row.latest_case_magic_link ?? null,
          teacherComment: canViewTeacherComments ? (row.teacher_comment ?? null) : null,
        })),
        meta: {
          ...buildPaginationMeta(page, limit, totalCount),
          summary,
          caseStatusSummary,
          thresholds,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getRiskDashboard error: ${message}`);
      throw err;
    }
  }
}

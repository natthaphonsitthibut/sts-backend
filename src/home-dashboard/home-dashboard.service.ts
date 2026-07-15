import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '../auth/permissions.constants';
import { getBangkokDateString } from '../common/utils/date.util';
import { HomeDashboardRepository } from './home-dashboard.repository';
import type {
  HomeDashboardActor,
  HomeDashboardFilterOptions,
  HomeDashboardFilters,
  HomeDashboardMetric,
  HomeDashboardPeriod,
  HomeDashboardSection,
  HomeDashboardSummary,
  HomeDashboardTrends,
  NormalizedHomeDashboardFilters,
} from './home-dashboard.types';

const DEFAULT_PERIOD: HomeDashboardPeriod = '30_DAYS';

function trim(value?: string): string | undefined {
  const next = value?.trim();
  return next && next.length > 0 ? next : undefined;
}

function hasActorPermission(actor: HomeDashboardActor, permission: string): boolean {
  return hasPermission(actor.roles || [], actor.permissions || [], permission);
}

@Injectable()
export class HomeDashboardService {
  private readonly logger = new Logger(HomeDashboardService.name);

  constructor(private readonly repository: HomeDashboardRepository) {}

  private normalizeFilters(input: HomeDashboardFilters): NormalizedHomeDashboardFilters {
    return {
      period: input.period || DEFAULT_PERIOD,
      province: trim(input.province),
      district: trim(input.district),
      subDistrict: trim(input.subDistrict),
      schoolId: input.schoolId,
      grade: trim(input.grade),
      room: trim(input.room),
    };
  }

  private assertFilterShape(filters: NormalizedHomeDashboardFilters): void {
    if (filters.district && !filters.province) {
      throw new BadRequestException('ต้องระบุจังหวัดก่อนอำเภอ');
    }
    if (filters.subDistrict && !filters.district) {
      throw new BadRequestException('ต้องระบุอำเภอก่อนตำบล');
    }
    if (filters.room && !filters.grade) {
      throw new BadRequestException('ต้องระบุระดับชั้นก่อนห้อง');
    }
  }

  private async assertFiltersAllowed(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
  ): Promise<void> {
    this.assertFilterShape(filters);
    const allowed = await this.repository.validateAreaFilters(actor, filters);
    if (!allowed) {
      throw new ForbiddenException('ขอบเขตข้อมูลไม่อยู่ในสิทธิ์ของผู้ใช้');
    }
  }

  private resolveSections(actor: HomeDashboardActor): HomeDashboardSection[] {
    const sections: HomeDashboardSection[] = ['attention', 'recentWork'];
    if (
      hasActorPermission(actor, 'attendance') ||
      hasActorPermission(actor, 'attendance-dashboard')
    ) {
      sections.push('attendanceTrend');
    }
    if (hasActorPermission(actor, 'dashboard')) {
      sections.push('riskDistribution');
    }
    if (hasActorPermission(actor, 'review-cases')) {
      sections.push('casePipeline', 'caseMovement');
    }
    return sections;
  }

  private async getPeriodStart(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
    today: string,
  ): Promise<string> {
    if (filters.period === 'CURRENT_TERM') {
      return (await this.repository.getCurrentTermStart(actor, filters, today)) ?? today;
    }
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (filters.period === '7_DAYS' ? 6 : 29));
    return date.toISOString().slice(0, 10);
  }

  private getScopeLabel(filters: NormalizedHomeDashboardFilters): string {
    const parts = [
      filters.province,
      filters.district,
      filters.subDistrict,
      filters.schoolId ? `โรงเรียน ${filters.schoolId}` : undefined,
      filters.grade,
      filters.room ? `ห้อง ${filters.room}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' / ') : 'ขอบเขตของฉัน';
  }

  private targetQuery(filters: NormalizedHomeDashboardFilters): Record<string, string | number> {
    const query: Record<string, string | number> = {};
    if (filters.province) query.province = filters.province;
    if (filters.district) query.district = filters.district;
    if (filters.subDistrict) query.subDistrict = filters.subDistrict;
    if (filters.schoolId) query.schoolId = filters.schoolId;
    if (filters.grade) query.grade = filters.grade;
    if (filters.room) query.room = filters.room;
    return query;
  }

  async getSummary(
    actor: HomeDashboardActor,
    input: HomeDashboardFilters,
  ): Promise<HomeDashboardSummary> {
    const filters = this.normalizeFilters(input);
    await this.assertFiltersAllowed(actor, filters);

    const sections = this.resolveSections(actor);
    const [totalStudents, activeCases, watchStudents, casePipeline, attentionRows] =
      await Promise.all([
        this.repository.countStudents(actor, filters),
        hasActorPermission(actor, 'review-cases')
          ? this.repository.countActiveCases(actor, filters)
          : Promise.resolve(0),
        hasActorPermission(actor, 'dashboard')
          ? this.repository.countHighRiskStudents(actor, filters)
          : Promise.resolve(0),
        hasActorPermission(actor, 'review-cases')
          ? this.repository.getCasePipeline(actor, filters)
          : Promise.resolve(null),
        this.repository.getAttentionItems(actor, filters, getBangkokDateString()),
      ]);

    const baseQuery = this.targetQuery(filters);
    const metrics: HomeDashboardMetric[] = [
      {
        key: 'totalStudents',
        label: 'ทั้งหมด',
        value: totalStudents,
        targetPath: '/students',
        targetQuery: baseQuery,
        tone: 'default',
      },
    ];
    if (sections.includes('riskDistribution')) {
      metrics.push({
        key: 'watchStudents',
        label: 'เสี่ยงสูง',
        value: watchStudents,
        targetPath: '/student-risk-report',
        targetQuery: { ...baseQuery, riskTier: 'HIGH' },
        tone: watchStudents > 0 ? 'danger' : 'success',
      });
    }
    if (sections.includes('casePipeline')) {
      metrics.push({
        key: 'activeCases',
        label: 'กำลังติดตาม',
        value: activeCases,
        targetPath: '/cases',
        targetQuery: { ...baseQuery, status: 'IN_PROGRESS' },
        tone: activeCases > 0 ? 'warning' : 'success',
      });
      metrics.push({
        key: 'pendingReview',
        label: 'รอตรวจผล',
        value: casePipeline?.PENDING_REVIEW ?? 0,
        targetPath: '/cases',
        targetQuery: { ...baseQuery, status: 'PENDING_REVIEW' },
        tone: (casePipeline?.PENDING_REVIEW ?? 0) > 0 ? 'info' : 'success',
      });
    }

    const attentionItems = attentionRows
      .filter((item) => {
        if (item.kind === 'ATTENDANCE_INCOMPLETE') {
          return sections.includes('attendanceTrend');
        }
        if (item.kind === 'RISK_HIGH') {
          return sections.includes('riskDistribution');
        }
        return sections.includes('casePipeline');
      })
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        reason: item.reason,
        count: Number(item.count || 0),
        ageLabel: item.age_label,
        targetPath: item.target_path,
        targetQuery: { ...baseQuery, ...(item.target_query || {}) },
        priority: Number(item.priority || 99),
      }));

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        scopeLabel: this.getScopeLabel(filters),
        period: filters.period,
        availableSections: sections,
        metrics,
        attentionSummary: {
          total: attentionItems.reduce((sum, item) => sum + item.count, 0),
          critical: attentionItems.filter((item) => item.kind === 'RISK_HIGH').length,
          warning: attentionItems.length,
        },
        attentionItems,
      },
    };
  }

  async getTrends(
    actor: HomeDashboardActor,
    input: HomeDashboardFilters,
  ): Promise<HomeDashboardTrends> {
    const filters = this.normalizeFilters(input);
    await this.assertFiltersAllowed(actor, filters);

    const sections = this.resolveSections(actor);
    const today = getBangkokDateString();
    const startsOn = await this.getPeriodStart(actor, filters, today);

    const [attendanceTrend, riskDistribution, riskThresholds, casePipeline, caseMovement] =
      await Promise.all([
        sections.includes('attendanceTrend')
          ? this.repository.getAttendanceTrend(actor, filters, startsOn, today)
          : Promise.resolve(null),
        sections.includes('riskDistribution')
          ? this.repository.getRiskDistribution(actor, filters)
          : Promise.resolve(null),
        sections.includes('riskDistribution')
          ? this.repository.getRiskThresholds()
          : Promise.resolve(null),
        sections.includes('casePipeline')
          ? this.repository.getCasePipeline(actor, filters)
          : Promise.resolve(null),
        sections.includes('caseMovement')
          ? this.repository.getCaseMovement(actor, filters, startsOn, today)
          : Promise.resolve(null),
      ]);

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        scopeLabel: this.getScopeLabel(filters),
        period: filters.period,
        availableSections: sections,
        attendanceTrend,
        riskDistribution: riskDistribution
          ? {
              asOf: today,
              thresholds: riskThresholds ?? {},
              summary: riskDistribution,
            }
          : null,
        casePipeline,
        caseMovement,
      },
    };
  }

  async getFilterOptions(
    actor: HomeDashboardActor,
    input: HomeDashboardFilters,
  ): Promise<HomeDashboardFilterOptions> {
    const filters = this.normalizeFilters(input);
    await this.assertFiltersAllowed(actor, filters);

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        scopeLabel: this.getScopeLabel(filters),
        options: await this.repository.getFilterOptions(actor, filters),
      },
    };
  }
}

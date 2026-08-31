import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { getBangkokDateString } from '../common/utils/date.util';
import { HomeDashboardRepository } from './home-dashboard.repository';
import type {
  HomeDashboardActor,
  HomeDashboardFilterOptions,
  HomeDashboardFilters,
  HomeDashboardFollowUpInsights,
  HomeDashboardLabelCount,
  HomeDashboardMetric,
  HomeDashboardProblemCategoryPoint,
  HomeDashboardPeriod,
  HomeDashboardRiskAreaDimension,
  HomeDashboardRiskAreaPoint,
  HomeDashboardSection,
  HomeDashboardSummary,
  HomeDashboardTrends,
  NormalizedHomeDashboardFilters,
} from './home-dashboard.types';

const DEFAULT_PERIOD: HomeDashboardPeriod = '30_DAYS';

/**
 * Where a case count opens. It has to be the route the menu table lists, because
 * the frontend resolves "may this account open it" by exact menu route: `/cases`
 * is only a legacy redirect and carries no menu entry, so every case tile
 * rendered dead for every account, admins included. `/student-risk-report`
 * forwards to the case list and keeps the query string.
 */
const CASE_LIST_PATH = '/student-risk-report';

function trim(value?: string): string | undefined {
  const next = value?.trim();
  return next && next.length > 0 ? next : undefined;
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

  /**
   * หน้าหลัก shows the same picture to every role: which pages an account may
   * OPEN is a permission question, but what the overview says about the scope it
   * already sees is not — a ผู้บริหาร reading a different summary from an admin
   * standing in the same scope was the bug. Scope itself still narrows every
   * number, because each repository call filters by the actor's data_scope.
   */
  private resolveSections(): HomeDashboardSection[] {
    return [
      'riskAreaRanking',
      'attendanceTrend',
      'riskDistribution',
      'casePipeline',
      'caseMovement',
    ];
  }

  /**
   * Once the scope is a single school, geography stops being the unit that
   * matters: a lone school on a national map says nothing. The ranking keeps
   * drilling, but through the structure the school itself works with.
   */
  private resolveRiskAreaDimension(
    filters: NormalizedHomeDashboardFilters,
  ): HomeDashboardRiskAreaDimension {
    if (filters.grade) return 'ROOM';
    if (filters.schoolId) return 'GRADE';
    if (filters.subDistrict) return 'SCHOOL';
    if (filters.district) return 'SUB_DISTRICT';
    if (filters.province) return 'DISTRICT';
    return 'PROVINCE';
  }

  private getRiskAreaDimensionLabel(dimension: HomeDashboardRiskAreaDimension): string {
    const labels: Record<HomeDashboardRiskAreaDimension, string> = {
      PROVINCE: 'จังหวัด',
      DISTRICT: 'อำเภอ/เขต',
      SUB_DISTRICT: 'ตำบล/แขวง',
      SCHOOL: 'โรงเรียน',
      GRADE: 'ระดับชั้น',
      ROOM: 'ห้องเรียน',
    };
    return labels[dimension];
  }

  private getRiskAreaTargetFilter(
    dimension: HomeDashboardRiskAreaDimension,
    point: Omit<HomeDashboardRiskAreaPoint, 'targetFilter'>,
  ): HomeDashboardRiskAreaPoint['targetFilter'] {
    if (dimension === 'PROVINCE') return { province: point.key };
    if (dimension === 'DISTRICT') return { district: point.key };
    if (dimension === 'SUB_DISTRICT') return { subDistrict: point.key };
    if (dimension === 'GRADE') return { grade: point.key };
    if (dimension === 'ROOM') return { room: point.key };
    return { schoolId: Number(point.key) };
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

  private async getScopeLabel(filters: NormalizedHomeDashboardFilters): Promise<string> {
    const schoolName = filters.schoolId
      ? await this.repository.getSchoolName(filters.schoolId)
      : undefined;
    const parts = [
      filters.province,
      filters.district,
      filters.subDistrict,
      schoolName ?? (filters.schoolId ? `โรงเรียน ${filters.schoolId}` : undefined),
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

    const sections = this.resolveSections();
    const riskAreaDimension = this.resolveRiskAreaDimension(filters);
    const [totalStudents, watchStudents, casePipeline, riskAreaRows, monthlySuccessRates] =
      await Promise.all([
        this.repository.countStudents(actor, filters),
        this.repository.countHighRiskStudents(actor, filters),
        this.repository.getCasePipeline(actor, filters),
        this.repository.getHighRiskAreaRanking(actor, filters, riskAreaDimension),
        this.repository.getMonthlySuccessRates(actor, filters),
      ]);

    const baseQuery = this.targetQuery(filters);
    const metrics: HomeDashboardMetric[] = [
      {
        key: 'totalStudents',
        label: 'นักเรียนทั้งหมด',
        value: totalStudents,
        targetPath: '/students',
        targetQuery: baseQuery,
        tone: 'default',
      },
    ];
    if (sections.includes('riskDistribution')) {
      metrics.push({
        key: 'watchStudents',
        label: 'นักเรียนกลุ่มเสี่ยง',
        value: watchStudents,
        targetPath: '/student-risk-report',
        targetQuery: { ...baseQuery, riskTier: 'HIGH' },
        tone: watchStudents > 0 ? 'danger' : 'success',
      });
    }
    if (sections.includes('casePipeline')) {
      const openCount = casePipeline?.OPEN ?? 0;
      const inProgressCount = casePipeline?.IN_PROGRESS ?? 0;
      const pendingReviewCount = casePipeline?.PENDING_REVIEW ?? 0;
      const resolvedCount = casePipeline?.RESOLVED ?? 0;
      const ongoingCount = openCount + inProgressCount + pendingReviewCount;
      const totalCount = ongoingCount + resolvedCount;

      metrics.push({
        key: 'totalCases',
        label: 'เคสทั้งหมด',
        value: totalCount,
        targetPath: CASE_LIST_PATH,
        targetQuery: { ...baseQuery },
        tone: 'default',
      });
      metrics.push({
        key: 'inProgressCases',
        label: 'เคสที่กำลังดำเนินการ',
        value: ongoingCount,
        targetPath: CASE_LIST_PATH,
        targetQuery: { ...baseQuery, caseStatus: 'OPEN,IN_PROGRESS,PENDING_REVIEW' },
        tone: 'warning',
      });
      metrics.push({
        key: 'resolvedCases',
        label: 'เคสที่เสร็จสิ้น',
        value: resolvedCount,
        targetPath: CASE_LIST_PATH,
        targetQuery: { ...baseQuery, caseStatus: 'RESOLVED' },
        tone: 'success',
      });
    }

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        scopeLabel: await this.getScopeLabel(filters),
        period: filters.period,
        availableSections: sections,
        metrics,
        attentionSummary: {
          total: 0,
          critical: 0,
          warning: 0,
        },
        attentionItems: [],
        riskAreaRanking: {
          dimension: riskAreaDimension,
          dimensionLabel: this.getRiskAreaDimensionLabel(riskAreaDimension),
          items: riskAreaRows.map((point) => ({
            ...point,
            targetFilter: this.getRiskAreaTargetFilter(riskAreaDimension, point),
          })),
        },
        casePipeline,
        monthlySuccessRates,
      },
    };
  }

  async getTrends(
    actor: HomeDashboardActor,
    input: HomeDashboardFilters,
  ): Promise<HomeDashboardTrends> {
    const filters = this.normalizeFilters(input);
    await this.assertFiltersAllowed(actor, filters);

    const sections = this.resolveSections().filter((section) => section !== 'riskAreaRanking');
    const today = getBangkokDateString();
    const startsOn = await this.getPeriodStart(actor, filters, today);

    const [
      attendanceTrend,
      riskDistribution,
      riskThresholds,
      casePipeline,
      caseMovement,
      gradeRiskDistribution,
    ] = await Promise.all([
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
      // Only meaningful once the scope is one school; asking for it nationwide
      // would return every grade label in the country.
      filters.schoolId
        ? this.repository.getGradeRiskDistribution(actor, filters)
        : Promise.resolve(null),
    ]);

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        scopeLabel: await this.getScopeLabel(filters),
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
        gradeRiskDistribution,
      },
    };
  }

  async getFollowUpInsights(
    actor: HomeDashboardActor,
    input: HomeDashboardFilters,
  ): Promise<HomeDashboardFollowUpInsights> {
    const filters = this.normalizeFilters(input);
    await this.assertFiltersAllowed(actor, filters);

    const areaDimension = this.resolveProblemAreaDimension(filters);
    const [
      coverage,
      followUpCategories,
      observationCategories,
      absenceReasonCategories,
      concernLevels,
      problemByOutcome,
      problemAreaRows,
      unreachableReasons,
      referralFunnel,
      otherProblemDetails,
    ] = await Promise.all([
      this.repository.getFollowUpCoverage(actor, filters),
      this.repository.getFollowUpProblemCategories(actor, filters),
      this.repository.getObservationProblemCategories(actor, filters),
      this.repository.getFollowUpAbsenceReasonCategories(actor, filters),
      this.repository.getTeacherConcernLevels(actor, filters),
      this.repository.getProblemOutcomeMatrix(actor, filters),
      areaDimension
        ? this.repository.getProblemAreaMatrix(actor, filters, areaDimension)
        : Promise.resolve(null),
      this.repository.getNonFollowUpReasons(actor, filters),
      this.repository.getReferralFunnel(actor, filters),
      // Free text about a child's family situation only helps the people who
      // can act on that child. A province- or nationwide reader is making
      // policy from counts, so they get the count and not the story.
      this.isSchoolLevelScope(actor, filters)
        ? this.repository.getOtherProblemDetails(actor, filters)
        : Promise.resolve([]),
    ]);

    const problemCategories = this.mergeProblemCategories(
      followUpCategories,
      observationCategories,
    );
    // The cross-tab counts follow-up findings only, so its columns come from the
    // follow-up list; taking them from the merged list would print a column of
    // dashes for a category only homeroom teachers ever recorded.
    const categories = followUpCategories.map(({ key, label }) => ({ key, label }));

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        scopeLabel: await this.getScopeLabel(filters),
        coverage,
        problemCategories,
        otherProblemDetails,
        absenceReasonCategories,
        concernLevels,
        problemByOutcome,
        problemByArea:
          areaDimension && problemAreaRows
            ? {
                dimension: areaDimension,
                dimensionLabel: this.getRiskAreaDimensionLabel(areaDimension),
                categories,
                rows: problemAreaRows,
              }
            : null,
        unreachableReasons,
        referralFunnel,
      },
    };
  }

  /**
   * Follow-up findings and homeroom observations answer the same question from
   * two directions, so they share a row and keep their own counts rather than
   * being summed into a single number whose provenance nobody can check.
   */
  private mergeProblemCategories(
    followUpCategories: HomeDashboardLabelCount[],
    observationCategories: HomeDashboardLabelCount[],
  ): HomeDashboardProblemCategoryPoint[] {
    const merged = new Map<string, HomeDashboardProblemCategoryPoint>();
    const upsert = (entry: HomeDashboardLabelCount, field: 'followUp' | 'observation'): void => {
      const current = merged.get(entry.key) ?? {
        key: entry.key,
        label: entry.label,
        followUp: 0,
        observation: 0,
        total: 0,
      };
      current[field] += entry.count;
      current.total += entry.count;
      merged.set(entry.key, current);
    };
    followUpCategories.forEach((entry) => upsert(entry, 'followUp'));
    observationCategories.forEach((entry) => upsert(entry, 'observation'));
    return Array.from(merged.values()).sort((left, right) => right.total - left.total);
  }

  /**
   * Whether the reader is standing inside one school — either because they
   * filtered down to it, or because their account never sees more than that.
   */
  private isSchoolLevelScope(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
  ): boolean {
    if (filters.schoolId !== undefined) return true;
    return actor.data_scope?.school_ids?.length === 1;
  }

  /**
   * Which geography the problem mix is broken down by. Inside a single school
   * there is no area left to compare, so the cross-tab is dropped rather than
   * rendered as one row.
   */
  private resolveProblemAreaDimension(
    filters: NormalizedHomeDashboardFilters,
  ): 'PROVINCE' | 'DISTRICT' | 'SUB_DISTRICT' | 'SCHOOL' | null {
    if (filters.schoolId) return null;
    if (filters.subDistrict) return 'SCHOOL';
    if (filters.district) return 'SUB_DISTRICT';
    if (filters.province) return 'DISTRICT';
    return 'PROVINCE';
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
        scopeLabel: await this.getScopeLabel(filters),
        options: await this.repository.getFilterOptions(actor, filters),
      },
    };
  }
}

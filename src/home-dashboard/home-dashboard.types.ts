import type { ActorContext, DataScope, QueryResultRow } from '../task/task.types';

export type HomeDashboardPeriod = '7_DAYS' | '30_DAYS' | 'CURRENT_TERM';
export type HomeDashboardSection =
  | 'attention'
  | 'attendanceTrend'
  | 'riskDistribution'
  | 'riskAreaRanking'
  | 'casePipeline'
  | 'caseMovement'
  | 'recentWork';
export type HomeDashboardAttentionKind = 'RISK_HIGH' | 'CASE_OVERDUE' | 'CASE_PENDING_REVIEW';

export interface HomeDashboardFilters {
  period?: HomeDashboardPeriod;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  grade?: string;
  room?: string;
}

export interface NormalizedHomeDashboardFilters extends HomeDashboardFilters {
  period: HomeDashboardPeriod;
}

export interface HomeDashboardActor extends ActorContext {
  data_scope?: DataScope;
}

export interface CountRow extends QueryResultRow {
  count: number | string;
}

export interface HomeDashboardMetric {
  key: string;
  label: string;
  value: number;
  targetPath: string;
  targetQuery?: Record<string, string | number>;
  tone: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export interface HomeDashboardAttentionItem {
  id: string;
  kind: HomeDashboardAttentionKind;
  label: string;
  reason: string;
  count: number;
  ageLabel: string | null;
  targetPath: string;
  targetQuery?: Record<string, string | number>;
  priority: number;
}

export type HomeDashboardRiskAreaDimension =
  | 'PROVINCE'
  | 'DISTRICT'
  | 'SUB_DISTRICT'
  | 'SCHOOL'
  | 'GRADE'
  | 'ROOM';

export interface HomeDashboardRiskAreaPoint {
  key: string;
  label: string;
  count: number;
  areaCode: string | null;
  targetFilter: {
    province?: string;
    district?: string;
    subDistrict?: string;
    schoolId?: number;
    grade?: string;
    room?: string;
  };
}

export interface HomeDashboardRiskAreaRanking {
  dimension: HomeDashboardRiskAreaDimension;
  dimensionLabel: string;
  items: HomeDashboardRiskAreaPoint[];
}

export interface HomeDashboardSummary {
  success: true;
  data: {
    generatedAt: string;
    scopeLabel: string;
    period: HomeDashboardPeriod;
    availableSections: HomeDashboardSection[];
    metrics: HomeDashboardMetric[];
    attentionSummary: {
      total: number;
      critical: number;
      warning: number;
    };
    attentionItems: HomeDashboardAttentionItem[];
    riskAreaRanking: HomeDashboardRiskAreaRanking;
    casePipeline: HomeDashboardCasePipeline | null;
    monthlySuccessRates: { month: string; opened: number; resolved: number }[];
  };
}

export interface HomeDashboardTrendPoint {
  key: string;
  label: string;
  present: number;
  absent: number;
  late: number;
  total: number;
  attendanceRate: number | null;
}

export interface HomeDashboardRiskDistribution {
  HIGH: number;
  WATCH: number;
  NORMAL: number;
}

export interface HomeDashboardCasePipeline {
  OPEN: number;
  IN_PROGRESS: number;
  PENDING_REVIEW: number;
  RESOLVED: number;
}

export interface HomeDashboardCaseMovementPoint {
  key: string;
  label: string;
  opened: number;
  resolved: number;
}

export interface HomeDashboardGradeRiskPoint {
  key: string;
  label: string;
  HIGH: number;
  WATCH: number;
  NORMAL: number;
  total: number;
}

export interface HomeDashboardTrends {
  success: true;
  data: {
    generatedAt: string;
    scopeLabel: string;
    period: HomeDashboardPeriod;
    availableSections: HomeDashboardSection[];
    attendanceTrend: HomeDashboardTrendPoint[] | null;
    riskDistribution: {
      asOf: string;
      thresholds: Record<string, number>;
      summary: HomeDashboardRiskDistribution;
    } | null;
    casePipeline: HomeDashboardCasePipeline | null;
    caseMovement: HomeDashboardCaseMovementPoint[] | null;
    gradeRiskDistribution: HomeDashboardGradeRiskPoint[] | null;
  };
}

export interface HomeDashboardOption {
  value: string | number;
  label: string;
}

export interface HomeDashboardFilterOptions {
  success: true;
  data: {
    generatedAt: string;
    scopeLabel: string;
    options: {
      provinces: HomeDashboardOption[];
      districts: HomeDashboardOption[];
      subDistricts: HomeDashboardOption[];
      schools: HomeDashboardOption[];
      grades: HomeDashboardOption[];
      rooms: HomeDashboardOption[];
    };
  };
}

export interface HomeDashboardLabelCount {
  key: string;
  label: string;
  count: number;
}

/**
 * How much of the at-risk population the follow-up charts actually speak for.
 * `atRiskStudents` is a snapshot of who carries the HIGH tier right now — the same
 * number the นักเรียนกลุ่มเสี่ยง tile shows — so a
 * student whose case closed and whose tier fell back to NORMAL leaves it — which
 * is why it can read 0 while closed cases exist. `recordedStudents` is the
 * population the charts below actually describe: everyone with a follow-up on
 * record in this scope, still at risk or not.
 */
export interface HomeDashboardFollowUpCoverage {
  atRiskStudents: number;
  followedUpStudents: number;
  pendingStudents: number;
  recordedStudents: number;
}

export interface HomeDashboardProblemOutcomeRow {
  key: string;
  label: string;
  total: number;
  outcomes: HomeDashboardLabelCount[];
}

export interface HomeDashboardProblemAreaRow {
  key: string;
  label: string;
  total: number;
  counts: Record<string, number>;
}

export interface HomeDashboardProblemAreaMatrix {
  dimension: HomeDashboardRiskAreaDimension;
  dimensionLabel: string;
  categories: Array<{ key: string; label: string }>;
  rows: HomeDashboardProblemAreaRow[];
}

export interface HomeDashboardReferralFunnel {
  referred: number;
  accepted: number;
  pending: number;
}

/**
 * The same problem seen from both sides: what a follow-up visit established, and
 * what the homeroom teacher recorded. Teacher observations reach students who
 * have no case yet, so keeping the two counts apart is what makes the chart
 * honest about where each number came from.
 */
export interface HomeDashboardProblemCategoryPoint {
  key: string;
  label: string;
  followUp: number;
  observation: number;
  total: number;
}

export interface HomeDashboardFollowUpInsights {
  success: true;
  data: {
    generatedAt: string;
    scopeLabel: string;
    coverage: HomeDashboardFollowUpCoverage;
    problemCategories: HomeDashboardProblemCategoryPoint[];
    /** ข้อความที่ผู้ติดตามกรอกไว้ใต้หมวด "อื่น ๆ" — บอกว่าก้อนนั้นคืออะไรจริง ๆ */
    otherProblemDetails: string[];
    absenceReasonCategories: HomeDashboardLabelCount[];
    concernLevels: HomeDashboardLabelCount[];
    problemByOutcome: HomeDashboardProblemOutcomeRow[];
    problemByArea: HomeDashboardProblemAreaMatrix | null;
    unreachableReasons: HomeDashboardLabelCount[];
    referralFunnel: HomeDashboardReferralFunnel;
  };
}

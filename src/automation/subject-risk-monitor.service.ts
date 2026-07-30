import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { getBangkokDateString } from '../common/utils/date.util';
import { AutomationRepository } from './automation.repository';
import { SUBJECT_RISK_DEFAULTS, SUBJECT_RISK_SETTING_KEYS } from './subject-risk-monitor.constants';
import type {
  ActiveAttendanceRiskCaseRow,
  CaseRiskTier,
  NewCase,
  QueryExecutor,
  SubjectLateWatchRow,
  SubjectRiskCandidateRow,
  SubjectRiskSignalCode,
} from './automation.types';

const CASE_RISK_TIER_RANK: Record<CaseRiskTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const SYSTEM_ACTOR_LABEL = 'system:subject-risk-monitor';

interface SubjectRiskSettings {
  mixedAbsenceWindowDays: number;
  mixedAbsenceDays: number;
  avoidanceWindowDays: number;
  avoidanceConsecutivePeriods: number;
  avoidanceAbsentPercent: number;
  lateWindowDays: number;
  lateWatchCount: number;
  termAbsenceDays: number;
  highAttendancePercent: number;
  slaHighDays: number;
  slaMediumDays: number;
}

interface CaseReviewNoteEvent {
  caseId: number;
  studentUuid: string | null;
  note: string;
}

interface SubjectRiskTierEscalationEvent {
  caseId: number;
  studentUuid: string | null;
  studentName: string | null;
  schoolId: number | null;
  fromTier: CaseRiskTier;
  toTier: CaseRiskTier;
  reason: string;
}

interface LateWatchNotificationEvent {
  studentName: string | null;
  schoolId: number | null;
  gradeLevel: string | number | null;
  roomId: string | number | null;
  reason: string;
  refId: string;
}

@Injectable()
export class SubjectRiskMonitorService {
  private readonly logger = new Logger(SubjectRiskMonitorService.name);

  constructor(
    private readonly automationRepository: AutomationRepository,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  private parsePositiveIntegerSetting(value: string | null, fallback: number): number {
    const parsed = value ? Number.parseInt(value, 10) : fallback;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private normalizeText(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    return '';
  }

  private normalizeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private normalizeSchoolId(value: unknown): number | null {
    const normalized = this.normalizeNumber(value);
    return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
  }

  private buildStudentName(
    student: Pick<
      SubjectRiskCandidateRow | SubjectLateWatchRow,
      'first_name_onec' | 'last_name_onec'
    >,
  ): string {
    return [this.normalizeText(student.first_name_onec), this.normalizeText(student.last_name_onec)]
      .filter((part) => part.length > 0)
      .join(' ');
  }

  private buildStudentTermAddress(student: SubjectRiskCandidateRow): string {
    const parts: string[] = [];
    const villageNumber = this.normalizeText(student.village_number_onec);
    const soi = this.normalizeText(student.soi_onec);
    const street = this.normalizeText(student.street_onec);
    const subDistrict = this.normalizeText(student.sub_district_name_thai_onec);
    const district = this.normalizeText(student.district_name_thai_onec);
    const province = this.normalizeText(student.province_name_thai_onec);

    if (villageNumber) parts.push(`หมู่ ${villageNumber}`);
    if (soi) parts.push(`ซอย${soi}`);
    if (street) parts.push(`ถนน${street}`);
    if (subDistrict) parts.push(`ตำบล/แขวง${subDistrict}`);
    if (district) parts.push(`อำเภอ/เขต${district}`);
    if (province) parts.push(`จังหวัด${province}`);

    return parts.join(' ');
  }

  private async loadSettings(): Promise<SubjectRiskSettings> {
    const keys = SUBJECT_RISK_SETTING_KEYS;
    const values = await Promise.all([
      this.automationRepository.getSystemSettingValue(keys.mixedAbsenceWindowDays),
      this.automationRepository.getSystemSettingValue(keys.mixedAbsenceDays),
      this.automationRepository.getSystemSettingValue(keys.avoidanceWindowDays),
      this.automationRepository.getSystemSettingValue(keys.avoidanceConsecutivePeriods),
      this.automationRepository.getSystemSettingValue(keys.avoidanceAbsentPercent),
      this.automationRepository.getSystemSettingValue(keys.lateWindowDays),
      this.automationRepository.getSystemSettingValue(keys.lateWatchCount),
      this.automationRepository.getSystemSettingValue(keys.termAbsenceDays),
      this.automationRepository.getSystemSettingValue(keys.highAttendancePercent),
      this.automationRepository.getSystemSettingValue(keys.slaHighDays),
      this.automationRepository.getSystemSettingValue(keys.slaMediumDays),
    ]);

    return {
      mixedAbsenceWindowDays: this.parsePositiveIntegerSetting(
        values[0],
        SUBJECT_RISK_DEFAULTS.mixedAbsenceWindowDays,
      ),
      mixedAbsenceDays: this.parsePositiveIntegerSetting(
        values[1],
        SUBJECT_RISK_DEFAULTS.mixedAbsenceDays,
      ),
      avoidanceWindowDays: this.parsePositiveIntegerSetting(
        values[2],
        SUBJECT_RISK_DEFAULTS.avoidanceWindowDays,
      ),
      avoidanceConsecutivePeriods: this.parsePositiveIntegerSetting(
        values[3],
        SUBJECT_RISK_DEFAULTS.avoidanceConsecutivePeriods,
      ),
      avoidanceAbsentPercent: this.parsePositiveIntegerSetting(
        values[4],
        SUBJECT_RISK_DEFAULTS.avoidanceAbsentPercent,
      ),
      lateWindowDays: this.parsePositiveIntegerSetting(
        values[5],
        SUBJECT_RISK_DEFAULTS.lateWindowDays,
      ),
      lateWatchCount: this.parsePositiveIntegerSetting(
        values[6],
        SUBJECT_RISK_DEFAULTS.lateWatchCount,
      ),
      termAbsenceDays: this.parsePositiveIntegerSetting(
        values[7],
        SUBJECT_RISK_DEFAULTS.termAbsenceDays,
      ),
      highAttendancePercent: this.parsePositiveIntegerSetting(
        values[8],
        SUBJECT_RISK_DEFAULTS.highAttendancePercent,
      ),
      slaHighDays: this.parsePositiveIntegerSetting(values[9], SUBJECT_RISK_DEFAULTS.slaHighDays),
      slaMediumDays: this.parsePositiveIntegerSetting(
        values[10],
        SUBJECT_RISK_DEFAULTS.slaMediumDays,
      ),
    };
  }

  private addDays(baseDate: Date, days: number): Date {
    return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private getSignalRiskTier(signalCode: SubjectRiskSignalCode): CaseRiskTier {
    return signalCode === 'LOW_ATTENDANCE_PERCENT' ? 'HIGH' : 'MEDIUM';
  }

  private buildRiskReason(candidate: SubjectRiskCandidateRow): string {
    const metric = this.normalizeNumber(candidate.metric_value);
    const threshold = this.normalizeNumber(candidate.threshold_value);
    const subjectName = this.normalizeText(candidate.subject_name_th);
    const subjectCode = this.normalizeText(candidate.subject_code);
    const subject = subjectName ? `${subjectName}${subjectCode ? ` (${subjectCode})` : ''}` : null;

    switch (candidate.signal_code) {
      case 'MIXED_SUBJECT_ABSENCE':
        return `โดดคาบ: มาเรียนบางคาบแต่ขาดบางคาบ ${metric} วัน (เกณฑ์ ${threshold} วัน)`;
      case 'SUBJECT_AVOIDANCE_STREAK':
        return `เลี่ยงวิชาเดิม: ขาด${subject ? `วิชา${subject}` : 'วิชาเดียวกัน'} ${metric} คาบติดกัน`;
      case 'SUBJECT_AVOIDANCE_PERCENT':
        return `เลี่ยงวิชาเดิม: ขาด${subject ? `วิชา${subject}` : 'วิชาเดียวกัน'} ${metric}% ของคาบในช่วงที่กำหนด`;
      case 'TERM_ABSENCE_ACCUMULATION':
        return `ขาดสะสมต่อเทอม ${metric} วัน (เกณฑ์ ${threshold} วัน)`;
      case 'LOW_ATTENDANCE_PERCENT':
        return `เวลาเรียนต่ำกว่าเกณฑ์: มาเรียน ${metric}% (ต่ำกว่า ${threshold}%)`;
      default:
        return 'เข้าเกณฑ์ความเสี่ยงจากเช็คชื่อรายวิชา';
    }
  }

  private buildLateWatchReason(row: SubjectLateWatchRow, settings: SubjectRiskSettings): string {
    const lateCount = this.normalizeNumber(row.late_count);
    return `มาสาย ${lateCount} ครั้งใน ${settings.lateWindowDays} วัน (เกณฑ์ ${settings.lateWatchCount} ครั้ง)`;
  }

  private normalizeCaseRiskTier(value: string | null): CaseRiskTier {
    return value === 'HIGH' || value === 'MEDIUM' ? value : 'LOW';
  }

  private async appendCaseNoteIfNew(
    existingCase: ActiveAttendanceRiskCaseRow,
    note: string,
    studentUuid: string | null,
    executor: QueryExecutor,
    events: CaseReviewNoteEvent[],
  ): Promise<void> {
    const alreadyInserted = await this.automationRepository.hasSystemCaseReviewNote(
      existingCase.id,
      note,
      executor,
    );
    if (alreadyInserted) return;
    await this.automationRepository.insertSystemCaseReviewNote(existingCase.id, note, executor);
    events.push({ caseId: existingCase.id, studentUuid, note });
  }

  async checkSubjectRiskSignals(): Promise<NewCase[]> {
    this.logger.log('Starting CRON Job: Checking subject attendance risk signals...');
    const settings = await this.loadSettings();
    const asOfDate = getBangkokDateString();
    const newCases: NewCase[] = [];
    const caseReviewEvents: CaseReviewNoteEvent[] = [];
    const tierEscalationEvents: SubjectRiskTierEscalationEvent[] = [];
    const lateWatchEvents: LateWatchNotificationEvent[] = [];
    const riskProfileStudentUuids = new Set<string>();

    try {
      await this.automationRepository.withTransaction(async (executor) => {
        const candidates = await this.automationRepository.listSubjectRiskCandidates(
          {
            asOfDate,
            mixedWindowDays: settings.mixedAbsenceWindowDays,
            mixedAbsenceDays: settings.mixedAbsenceDays,
            avoidanceWindowDays: settings.avoidanceWindowDays,
            avoidanceConsecutivePeriods: settings.avoidanceConsecutivePeriods,
            avoidanceAbsentPercent: settings.avoidanceAbsentPercent,
            termAbsenceDays: settings.termAbsenceDays,
            highAttendancePercent: settings.highAttendancePercent,
          },
          executor,
        );

        for (const candidate of candidates) {
          const studentName = this.buildStudentName(candidate);
          if (!studentName) continue;

          const studentUuid = this.normalizeText(candidate.student_uuid) || null;
          const schoolId = this.normalizeSchoolId(candidate.school_id_onec);
          const schoolName =
            this.normalizeText(candidate.school_name) ||
            `School ID: ${this.normalizeText(candidate.school_id_onec)}`;
          const reason = this.buildRiskReason(candidate);
          const riskTier = this.getSignalRiskTier(candidate.signal_code);
          const slaDays = riskTier === 'HIGH' ? settings.slaHighDays : settings.slaMediumDays;
          const slaDueAt = this.addDays(new Date(), slaDays);

          const existingCase =
            await this.automationRepository.findActiveAttendanceRiskCaseByStudent(
              studentUuid ?? '',
              studentName,
              schoolId,
              executor,
            );

          if (existingCase) {
            await this.appendCaseNoteIfNew(
              existingCase,
              reason,
              studentUuid,
              executor,
              caseReviewEvents,
            );
            const currentTier = this.normalizeCaseRiskTier(existingCase.risk_tier);
            if (CASE_RISK_TIER_RANK[riskTier] > CASE_RISK_TIER_RANK[currentTier]) {
              const escalated = await this.automationRepository.escalateCaseRiskTier(
                {
                  caseId: existingCase.id,
                  riskTier,
                  slaDueAt,
                  reason,
                },
                executor,
              );
              if (escalated) {
                tierEscalationEvents.push({
                  caseId: existingCase.id,
                  studentUuid,
                  studentName,
                  schoolId,
                  fromTier: currentTier,
                  toTier: riskTier,
                  reason,
                });
              }
            }
            if (studentUuid) riskProfileStudentUuids.add(studentUuid);
            continue;
          }

          const caseId = await this.automationRepository.createAutomatedCase(
            {
              studentName,
              studentUuid,
              schoolId,
              schoolName,
              studentAddress: this.buildStudentTermAddress(candidate) || null,
              reason,
              riskTier,
              slaDueAt,
            },
            executor,
          );
          newCases.push({
            case_id: caseId,
            student_name: studentName,
            student_school: schoolName,
            reason_flagged: reason,
            school_id: schoolId,
          });
          if (studentUuid) riskProfileStudentUuids.add(studentUuid);
        }

        const lateWatchRows = await this.automationRepository.listSubjectLateWatchCandidates(
          {
            asOfDate,
            lateWindowDays: settings.lateWindowDays,
            lateWatchCount: settings.lateWatchCount,
          },
          executor,
        );

        for (const row of lateWatchRows) {
          const studentUuid = this.normalizeText(row.student_uuid);
          const refId = `${studentUuid}:subject-late:${settings.lateWindowDays}:${settings.lateWatchCount}`;
          const alreadyNotified = await this.automationRepository.hasRiskWatchNotification(
            refId,
            executor,
          );
          if (alreadyNotified) continue;
          lateWatchEvents.push({
            studentName: this.buildStudentName(row),
            schoolId: this.normalizeSchoolId(row.school_id_onec),
            gradeLevel: this.normalizeText(row.grade_level_id_onec) || null,
            roomId: this.normalizeText(row.room_id_onec) || null,
            reason: this.buildLateWatchReason(row, settings),
            refId,
          });
        }
      });

      for (const event of caseReviewEvents) {
        await this.auditLog.record({
          actorUserId: null,
          actorLabel: SYSTEM_ACTOR_LABEL,
          action: 'CASE_REVIEW',
          targetType: 'case',
          targetId: String(event.caseId),
          metadata: {
            reviewAction: 'CONTINUE',
            reason: 'subject_risk_signal',
            studentUuid: event.studentUuid,
            note: event.note,
          },
          ip: null,
        });
      }

      for (const event of tierEscalationEvents) {
        await this.auditLog.record({
          actorUserId: null,
          actorLabel: SYSTEM_ACTOR_LABEL,
          action: 'CASE_RISK_TIER_ESCALATE',
          targetType: 'case',
          targetId: String(event.caseId),
          metadata: {
            reason: 'subject_risk_signal',
            studentUuid: event.studentUuid,
            fromTier: event.fromTier,
            toTier: event.toTier,
            signalReason: event.reason,
          },
          ip: null,
        });
        await this.notificationsService.notifyCaseRiskEscalated({
          caseId: event.caseId,
          studentName: event.studentName,
          schoolId: event.schoolId,
          fromTier: event.fromTier,
          toTier: event.toTier,
          reason: event.reason,
        });
      }

      for (const created of newCases) {
        await this.notificationsService.notifyCaseCreated({
          caseId: created.case_id,
          studentName: created.student_name,
          schoolId: created.school_id ?? null,
          schoolName: created.student_school,
          reason: created.reason_flagged,
        });
      }

      for (const event of lateWatchEvents) {
        await this.notificationsService.notifyStudentRiskWatch(event);
      }

      if (riskProfileStudentUuids.size > 0) {
        await this.riskProfileService
          ?.enqueueStudents([...riskProfileStudentUuids], 'subject-risk-monitor')
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to enqueue subject-risk profile recalculation: ${message}`);
          });
      }
    } catch (error) {
      this.logger.error('Error in checking subject attendance risk signals', error);
    }

    this.logger.log('Finished CRON Job: Checking subject attendance risk signals.');
    return newCases;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AutomationRepository } from './automation.repository';
import type {
  CaseAutoCancelAuditEvent,
  CumulativeAbsentStudentRow,
  NewCase,
} from './automation.types';
import { getBangkokDateString } from '../common/utils/date.util';

@Injectable()
export class AbsenceMonitorService {
  private readonly logger = new Logger(AbsenceMonitorService.name);

  constructor(
    private readonly automationRepository: AutomationRepository,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  private normalizeText(value: unknown): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }
    return '';
  }

  private buildStudentName(student: CumulativeAbsentStudentRow): string {
    const firstName = this.normalizeText(student.first_name_onec);
    const lastName = this.normalizeText(student.last_name_onec);
    return [firstName, lastName].filter((part) => part.length > 0).join(' ');
  }

  private normalizeSchoolId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
  }

  private buildStudentTermAddress(student: CumulativeAbsentStudentRow): string {
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

  private parsePositiveIntegerSetting(value: string | null, fallback: number): number {
    const parsed = value ? Number.parseInt(value, 10) : fallback;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private addDays(baseDate: Date, days: number): Date {
    return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  }

  async checkConsecutiveAbsences(): Promise<NewCase[]> {
    this.logger.log('Starting CRON Job: Checking cumulative absences...');

    // One rule opens a case: cumulative absent days reaching the เสี่ยง
    // threshold. The tier ladder (ต่ำ/ปานกลาง) and its SLAs are gone.
    const thresholdDays = this.parsePositiveIntegerSetting(
      await this.automationRepository.getSystemSettingValue('CASE_RISK_HIGH_ABSENCE_DAYS'),
      3,
    );
    const slaDays = this.parsePositiveIntegerSetting(
      await this.automationRepository.getSystemSettingValue('CASE_SLA_HIGH_DAYS'),
      3,
    );

    const newCases: NewCase[] = [];
    const autoCancelAuditEvents: CaseAutoCancelAuditEvent[] = [];
    const riskProfileStudentUuids = new Set<string>();

    try {
      await this.automationRepository.withTransaction(async (executor) => {
        const asOfDate = getBangkokDateString();
        const absentStudents = await this.automationRepository.listCumulativeAbsentStudents(
          thresholdDays,
          asOfDate,
          executor,
        );

        const absentUuidSet = new Set(
          absentStudents
            .map((student) => this.normalizeText(student.student_uuid))
            .filter((uuid) => uuid.length > 0),
        );
        const openCases = await this.automationRepository.listOpenAbsenceCases(executor);
        const evaluableUuidSet = new Set(
          await this.automationRepository.listEvaluableStudentUuids(
            openCases
              .map((openCase) => this.normalizeText(openCase.student_uuid))
              .filter((uuid) => uuid.length > 0),
            asOfDate,
            executor,
          ),
        );

        for (const openCase of openCases) {
          const caseStudentUuid = this.normalizeText(openCase.student_uuid);
          const caseStudentName = this.normalizeText(openCase.student_name);
          const caseSchoolId = this.normalizeSchoolId(openCase.school_id);
          if (!caseStudentUuid && (!caseStudentName || caseSchoolId === null)) {
            continue; // ระบุตัวไม่ได้ → ไม่แตะ (รักษา guard เดิม)
          }
          if (!caseStudentUuid || !evaluableUuidSet.has(caseStudentUuid)) {
            continue; // ข้อมูลไม่ครบหรือเคส legacy ระบุตัวไม่ได้ → ห้าม auto-cancel
          }
          // uuid-first; legacy name fallback must stay school-scoped.
          const stillAbsent = absentUuidSet.has(caseStudentUuid);
          if (!stillAbsent) {
            const cancelled = await this.automationRepository.deleteOpenCaseById(
              openCase.id,
              executor,
            );
            if (cancelled) {
              autoCancelAuditEvents.push({
                caseId: openCase.id,
                studentUuid: caseStudentUuid || null,
              });
              if (caseStudentUuid) {
                riskProfileStudentUuids.add(caseStudentUuid);
              }
            }
            this.logger.log(
              `Deleted / Canceled Case ${openCase.id} for ${caseStudentName || caseStudentUuid} due to attendance correction.`,
            );
          }
        }

        if (absentStudents.length === 0) {
          this.logger.log('No students found meeting the cumulative absence threshold.');
          return;
        }

        this.logger.log(`Found ${absentStudents.length} students over the threshold.`);

        for (const student of absentStudents) {
          const studentName = this.buildStudentName(student);
          if (!studentName) {
            continue;
          }
          const studentUuid = this.normalizeText(student.student_uuid) || null;
          const schoolId =
            typeof student.school_id_onec === 'number' && Number.isFinite(student.school_id_onec)
              ? student.school_id_onec
              : null;

          this.logger.log(`Checking existing cases for: ${studentName}`);

          const existingCase = await this.automationRepository.findActiveAbsenceCaseByStudent(
            studentUuid ?? '',
            studentName,
            schoolId,
            executor,
          );

          this.logger.log(`Existing case count for ${studentName}: ${existingCase ? 1 : 0}`);

          const reason = `ขาดเรียนสะสม ${student.absent_days} วัน`;
          const slaDueAt = this.addDays(new Date(), slaDays);

          if (existingCase) {
            // An active case already covers this student; there is no tier to
            // escalate to, so the growing count only shows up in the case notes.
            continue;
          }

          const schoolName =
            this.normalizeText(student.school_name) ||
            `School ID: ${this.normalizeText(student.school_id_onec)}`;
          const address = this.buildStudentTermAddress(student) || null;

          this.logger.log(`Inserting Case for ${studentName} with Reason: ${reason}`);

          const caseId = await this.automationRepository.createAutomatedCase(
            {
              studentName,
              studentUuid,
              schoolId,
              schoolName,
              studentAddress: address,
              reason,
              riskTier: 'HIGH',
              slaDueAt,
            },
            executor,
          );

          this.logger.log(`Generated Case ${caseId} for ${studentName}`);
          newCases.push({
            case_id: caseId,
            student_name: studentName,
            student_school: schoolName,
            reason_flagged: reason,
            school_id: schoolId,
          });
          if (studentUuid) {
            riskProfileStudentUuids.add(studentUuid);
          }
        }
      });

      for (const event of autoCancelAuditEvents) {
        await this.auditLog.record({
          actorUserId: null,
          actorLabel: 'system:absence-monitor',
          action: 'CASE_AUTO_CANCEL',
          targetType: 'case',
          targetId: String(event.caseId),
          metadata: {
            reason: 'attendance_corrected',
            studentUuid: event.studentUuid,
          },
          ip: null,
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

      if (riskProfileStudentUuids.size > 0) {
        await this.riskProfileService
          ?.requestStudentRecalculation([...riskProfileStudentUuids], 'case-auto-monitor')
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to enqueue absence-monitor risk profile recalculation: ${message}`,
            );
          });
      }
    } catch (error) {
      this.logger.error('Error in checking consecutive absences', error);
    }

    this.logger.log('Finished CRON Job: Checking cumulative absences.');
    return newCases;
  }
}

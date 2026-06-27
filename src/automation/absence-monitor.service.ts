import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AutomationRepository } from './automation.repository';
import type {
  CaseAutoCancelAuditEvent,
  ConsecutiveAbsentStudentRow,
  NewCase,
} from './automation.types';
import { getBangkokDateString } from '../common/utils/date.util';

@Injectable()
export class AbsenceMonitorService {
  private readonly logger = new Logger(AbsenceMonitorService.name);

  constructor(
    private readonly automationRepository: AutomationRepository,
    private readonly auditLog: AuditLogService,
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

  private buildStudentName(student: ConsecutiveAbsentStudentRow): string {
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

  private buildStudentTermAddress(student: ConsecutiveAbsentStudentRow): string {
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

  async checkConsecutiveAbsences(): Promise<NewCase[]> {
    this.logger.log('Starting CRON Job: Checking consecutive absences...');

    const thresholdSetting =
      await this.automationRepository.getSystemSettingValue('ABSENT_THRESHOLD_DAYS');
    const thresholdDays = thresholdSetting ? Number.parseInt(thresholdSetting, 10) : 3;

    if (!Number.isInteger(thresholdDays) || thresholdDays <= 0) {
      this.logger.warn('ABSENT_THRESHOLD_DAYS is invalid. Skipping job.');
      return [];
    }

    const newCases: NewCase[] = [];
    const autoCancelAuditEvents: CaseAutoCancelAuditEvent[] = [];

    try {
      await this.automationRepository.withTransaction(async (executor) => {
        const asOfDate = getBangkokDateString();
        const absentStudents = await this.automationRepository.listConsecutiveAbsentStudents(
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
            thresholdDays,
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
            }
            this.logger.log(
              `Deleted / Canceled Case ${openCase.id} for ${caseStudentName || caseStudentUuid} due to attendance correction.`,
            );
          }
        }

        if (absentStudents.length === 0) {
          this.logger.log('No students found meeting the consecutive absence threshold.');
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

          const existingCaseId = await this.automationRepository.findActiveAbsenceCaseByStudent(
            studentUuid ?? '',
            studentName,
            schoolId,
            executor,
          );

          this.logger.log(`Existing case count for ${studentName}: ${existingCaseId ? 1 : 0}`);

          if (existingCaseId) {
            continue;
          }

          const schoolName =
            this.normalizeText(student.school_name) ||
            `School ID: ${this.normalizeText(student.school_id_onec)}`;
          const address = this.buildStudentTermAddress(student) || null;
          const reason = `ขาดเรียนติดต่อกัน ${thresholdDays} วัน`;

          this.logger.log(`Inserting Case for ${studentName} with Reason: ${reason}`);

          const caseId = await this.automationRepository.createAutomatedCase(
            {
              studentName,
              studentUuid,
              schoolId,
              schoolName,
              studentAddress: address,
              reason,
            },
            executor,
          );

          this.logger.log(`Generated Case ${caseId} for ${studentName}`);
          newCases.push({
            case_id: caseId,
            student_name: studentName,
            student_school: schoolName,
            reason_flagged: reason,
          });
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
    } catch (error) {
      this.logger.error('Error in checking consecutive absences', error);
    }

    this.logger.log('Finished CRON Job: Checking consecutive absences.');
    return newCases;
  }
}

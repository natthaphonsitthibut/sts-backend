import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { hasPermission } from '../auth';
import { isAggregateOnlyExecutive } from '../auth/permissions.constants';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateCaseReportUpDto, ListCaseReportUpsDto } from './dto/case-report-ups.dto';
import { CaseReportUpsRepository } from './case-report-ups.repository';
import { REPORT_UP_SOURCE_STATUSES, type CaseReportUpRow } from './case-report-ups.types';

@Injectable()
export class CaseReportUpsService {
  constructor(
    private readonly repository: CaseReportUpsRepository,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private has(actor: AuthenticatedRequestUser, permission: string): boolean {
    return hasPermission(actor.roles, actor.permissions, permission);
  }

  private schoolIds(actor: AuthenticatedRequestUser): number[] {
    return Array.from(
      new Set(
        (actor.data_scope?.school_ids ?? [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value)),
      ),
    );
  }

  private actorLabel(actor: AuthenticatedRequestUser): string | null {
    const name = [actor.FirstName, actor.LastName].filter(Boolean).join(' ').trim();
    return name || actor.username || null;
  }

  private withoutTotalCount(row: CaseReportUpRow): CaseReportUpRow {
    const response = { ...row };
    delete response.total_count;
    return response;
  }

  private assertCanRead(actor: AuthenticatedRequestUser): void {
    if (isAggregateOnlyExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    if (!this.has(actor, 'report-up-cases')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูรายการเคสที่รายงานขึ้นส่วนกลาง');
    }
  }

  async reportUp(caseId: number, input: CreateCaseReportUpDto, actor: AuthenticatedRequestUser) {
    if (isAggregateOnlyExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารไม่มีสิทธิ์รายงานเคสรายบุคคล');
    }
    if (!this.has(actor, 'review-cases') || !this.has(actor, 'report-up-cases')) {
      throw new ForbiddenException('ไม่มีสิทธิ์รายงานเคสขึ้นส่วนกลาง');
    }
    const schoolIds = this.schoolIds(actor);
    if (schoolIds.length === 0) {
      throw new ForbiddenException('การรายงานเคสต้องใช้ขอบเขตระดับโรงเรียน');
    }
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) {
      throw new ForbiddenException('ไม่พบผู้ดำเนินการ');
    }

    const reportUp = await this.repository.withTransaction(async (queryRunner) => {
      const caseRecord = await this.repository.lockSchoolOwnedCase(caseId, schoolIds, queryRunner);
      if (!caseRecord) {
        throw new NotFoundException('ไม่พบเคสในขอบเขตโรงเรียนของคุณ');
      }
      if (!REPORT_UP_SOURCE_STATUSES.some((status) => status === caseRecord.status)) {
        throw new ConflictException('สถานะปัจจุบันของเคสไม่อนุญาตให้รายงานขึ้นส่วนกลาง');
      }

      const created = await this.repository.insertReportUp(
        {
          caseId,
          schoolId: caseRecord.school_id,
          reportedBy: actorId,
          reportedByLabel: this.actorLabel(actor),
          reason: input.reason.trim(),
          summary: input.summary.trim(),
          schoolName: caseRecord.school_name,
          province: caseRecord.province,
          district: caseRecord.district,
          subDistrict: caseRecord.sub_district,
        },
        queryRunner,
      );
      const transitioned = await this.repository.transitionCaseToReportedUp(
        caseId,
        caseRecord.status,
        queryRunner,
      );
      if (!transitioned) {
        throw new ConflictException('สถานะเคสเปลี่ยนระหว่างดำเนินการ กรุณาลองใหม่');
      }
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: this.actorLabel(actor),
          action: 'CASE_REVIEW',
          targetType: 'case',
          targetId: String(caseId),
          metadata: {
            reviewAction: 'REPORT_UP',
            reportUpId: created.id,
          },
          ip: null,
        },
        queryRunner,
      );
      return { created, caseRecord };
    });
    await this.notificationsService.notifyCaseStatusChanged({
      caseId,
      studentName: reportUp.caseRecord.student_name,
      schoolId: reportUp.caseRecord.school_id,
      nextStatus: 'REPORTED_UP',
      actorUserId: actorId,
    });

    return { success: true, data: reportUp.created };
  }

  async list(query: ListCaseReportUpsDto, actor: AuthenticatedRequestUser) {
    this.assertCanRead(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const result = await this.repository.listReportUps(actor.data_scope ?? {}, page, limit);
    return {
      data: result.rows.map((row) => this.withoutTotalCount(row)),
      meta: buildPaginationMeta(page, limit, result.totalCount),
    };
  }

  async listForCase(caseId: number, actor: AuthenticatedRequestUser) {
    this.assertCanRead(actor);
    const result = await this.repository.listReportUps(actor.data_scope ?? {}, 1, 20, caseId);
    if (result.rows.length === 0) {
      throw new NotFoundException('ไม่พบประวัติรายงานเคสในขอบเขตของคุณ');
    }
    return {
      data: result.rows.map((row) => this.withoutTotalCount(row)),
    };
  }
}

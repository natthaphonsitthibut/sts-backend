import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PII_REASON_LABELS, type PiiReasonCode } from '../students/pii-fields.config';
import { AuditLogService } from './audit-log.service';
import type { AuditAction } from './dto/audit-log.dto';

export type PiiAccessSubjectType = 'STUDENT' | 'TEACHER' | 'USER';
export type PiiAccessFieldGroup = 'NATIONAL_ID' | 'PASSPORT' | 'ADDRESS';

/** The audited action for each kind of record and each group of fields opened. */
const REVEAL_ACTIONS: Record<
  PiiAccessSubjectType,
  Partial<Record<PiiAccessFieldGroup, AuditAction>>
> = {
  STUDENT: {
    NATIONAL_ID: 'STUDENT_NATIONAL_ID_VIEW',
    PASSPORT: 'STUDENT_PASSPORT_VIEW',
    ADDRESS: 'STUDENT_ADDRESS_VIEW',
  },
  TEACHER: { NATIONAL_ID: 'TEACHER_NATIONAL_ID_VIEW' },
  USER: { NATIONAL_ID: 'USER_NATIONAL_ID_VIEW', ADDRESS: 'USER_ADDRESS_VIEW' },
};

export interface PiiAccessLogInput {
  actorUserId: number | null;
  /** Shown as ผู้ทำรายการ; a link teacher has no account, so the caller names them. */
  actorLabel: string | null;
  actorRoles: string[];
  actorTeacherMembershipId?: number | null;
  subjectType: PiiAccessSubjectType;
  /** Pseudonymous reference kept in the access record. */
  subjectRef: string;
  subjectRefKeyVersion: number;
  fieldGroup: PiiAccessFieldGroup;
  reasonCode: PiiReasonCode;
  reasonNote: string | null;
  purposeLinkId?: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** The record บันทึกการใช้งาน names as เป้าหมาย. */
  targetType: string;
  targetId: string;
  /** Where the record belongs (`schoolId` or `scope`), so scoped readers see it. */
  scopeMetadata?: Record<string, unknown>;
}

/**
 * Writes one reveal of personal data: the row บันทึกการใช้งาน lists and the PDPA
 * access record that points at it, in one transaction so neither exists alone.
 */
@Injectable()
export class PiiAccessLogService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  async record(input: PiiAccessLogInput): Promise<void> {
    const action = REVEAL_ACTIONS[input.subjectType][input.fieldGroup];
    if (!action) {
      throw new Error(`No audit action for ${input.subjectType} ${input.fieldGroup} reveal`);
    }

    await this.dataSource.transaction(async (manager) => {
      const auditLogId = await this.auditLog.recordAtomicReturningId(
        {
          action,
          actorUserId: input.actorUserId,
          actorLabel: input.actorLabel,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: {
            ...input.scopeMetadata,
            fieldGroup: input.fieldGroup,
            reasonCode: input.reasonCode,
            reasonLabel: PII_REASON_LABELS[input.reasonCode],
            ...(input.reasonNote ? { reasonNote: input.reasonNote } : {}),
          },
          ip: input.ip,
        },
        manager,
      );
      await manager.query(
        `
          INSERT INTO pii_access_events (
            actor_user_id,
            actor_teacher_membership_id,
            actor_roles,
            actor_kind,
            subject_student_ref,
            subject_type,
            subject_ref,
            subject_ref_key_version,
            field_group,
            reason_code,
            reason_note,
            purpose_link_id,
            request_id,
            ip,
            user_agent,
            audit_log_id
          )
          VALUES ($1, $2, $3::jsonb, 'STAFF', $4, $5, $4, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          input.actorUserId,
          input.actorTeacherMembershipId ?? null,
          JSON.stringify(input.actorRoles),
          input.subjectRef,
          input.subjectType,
          input.subjectRefKeyVersion,
          input.fieldGroup,
          input.reasonCode,
          input.reasonNote,
          input.purposeLinkId ?? null,
          input.requestId,
          input.ip,
          input.userAgent,
          auditLogId,
        ],
      );
    });
  }
}

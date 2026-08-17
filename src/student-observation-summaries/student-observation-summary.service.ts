import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { hasPermission, resolveActorDataScope, type AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import type {
  GenerateObservationSummaryDto,
  ReviewObservationSummaryDto,
} from './dto/student-observation-summary.dto';
import {
  OBSERVATION_SUMMARY_ADAPTER,
  type ObservationSummaryAdapter,
} from './observation-summary.adapter';
import { StudentObservationSummaryRepository } from './student-observation-summary.repository';
import type {
  ObservationSummaryAdapterResult,
  ObservationSummaryRow,
  ObservationSummarySourceRow,
} from './student-observation-summary.types';

@Injectable()
export class StudentObservationSummaryService {
  constructor(
    private readonly repository: StudentObservationSummaryRepository,
    private readonly auditLog: AuditLogService,
    @Inject(OBSERVATION_SUMMARY_ADAPTER) private readonly adapter: ObservationSummaryAdapter,
  ) {}

  private async access(studentUuid: string, actor: AuthenticatedRequestUser) {
    if (!hasPermission(actor.roles, actor.permissions, 'students')) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการสรุปข้อสังเกต');
    }
    if (actor.roles.includes('EXECUTIVE') && !actor.roles.includes('ADMIN')) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะข้อมูลสรุปรวมที่ไม่ระบุตัวบุคคล');
    }
    const enrollment = await this.repository.findEnrollment(studentUuid);
    if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
    if (
      !(await this.repository.isSchoolInScope(
        enrollment.school_id,
        resolveActorDataScope(actor) ?? {},
      ))
    ) {
      throw new NotFoundException('ไม่พบนักเรียนในขอบเขตของคุณ');
    }
    return enrollment;
  }

  private fingerprint(sources: ObservationSummarySourceRow[]): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          sources.map((source) => ({
            id: source.observation_id,
            revision: Number(source.observation_revision),
            dimension: source.dimension_code,
            concern: source.concern_level,
            comment: source.comment,
            observedAt: new Date(source.observed_at).toISOString(),
            tags: [...source.tag_codes].sort(),
          })),
        ),
      )
      .digest('hex');
  }

  private assertOutput(
    output: ObservationSummaryAdapterResult,
    sources: ObservationSummarySourceRow[],
  ): void {
    const arrays = [output.themes, output.trends, output.agreements, output.conflictingEvidence];
    if (
      !output.summaryText?.trim() ||
      output.summaryText.length > 10000 ||
      !output.providerCode?.trim() ||
      output.providerCode.length > 64 ||
      !output.modelCode?.trim() ||
      output.modelCode.length > 128 ||
      !output.promptVersion?.trim() ||
      output.promptVersion.length > 64 ||
      !Array.isArray(output.citations) ||
      arrays.some(
        (items) =>
          !Array.isArray(items) ||
          items.length > 50 ||
          items.some((item) => typeof item !== 'string' || !item.trim() || item.length > 1000),
      )
    ) {
      throw new ServiceUnavailableException('ระบบสรุปอัตโนมัติส่งผลลัพธ์ไม่สมบูรณ์');
    }
    const expected = new Set(
      sources.map((source) => `${source.observation_id}:${source.observation_revision}`),
    );
    const citations = new Set(
      output.citations.map((citation) => `${citation.observationId}:${citation.revision}`),
    );
    if (
      citations.size !== output.citations.length ||
      citations.size !== expected.size ||
      [...citations].some((citation) => !expected.has(citation))
    ) {
      throw new ServiceUnavailableException('ระบบสรุปอัตโนมัติอ้างอิงแหล่งข้อมูลไม่ถูกต้อง');
    }
  }

  private response(row: ObservationSummaryRow, stale = row.is_stale) {
    return {
      id: row.id,
      studentTermId: row.student_uuid,
      summaryText: row.summary_text,
      themes: row.themes,
      trends: row.trends,
      agreements: row.agreements,
      conflictingEvidence: row.conflicting_evidence,
      citations: row.citations,
      aiGenerated: true,
      providerCode: row.provider_code,
      modelCode: row.model_code,
      promptVersion: row.prompt_version,
      sourceObservationCount: Number(row.source_observation_count),
      isStale: stale,
      review: {
        state: row.review_state,
        reviewerDisplayName: row.reviewer_display_name,
        note: row.review_note,
        reviewedAt: row.reviewed_at,
      },
      generatedAt: row.generated_at,
    };
  }

  async generate(
    studentUuid: string,
    dto: GenerateObservationSummaryDto,
    actor: AuthenticatedRequestUser,
  ) {
    const enrollment = await this.access(studentUuid, actor);
    const sources = await this.repository.listSources(
      studentUuid,
      enrollment.school_id,
      dto.sourceObservationIds,
    );
    if (sources.length === 0) throw new BadRequestException('ยังไม่มีข้อสังเกตสำหรับสรุป');
    if (dto.sourceObservationIds && sources.length !== dto.sourceObservationIds.length) {
      throw new NotFoundException('มีข้อสังเกตต้นทางอยู่นอกขอบเขตหรือไม่พบข้อมูล');
    }
    const fingerprint = this.fingerprint(sources);
    const existing = await this.repository.findByFingerprint(studentUuid, fingerprint);
    if (existing) return { data: this.response(existing), reused: true };

    let output: ObservationSummaryAdapterResult;
    try {
      output = await this.adapter.generate({
        sources: sources.map((source) => ({
          observationId: source.observation_id,
          revision: Number(source.observation_revision),
          dimensionCode: source.dimension_code,
          concernLevel: source.concern_level,
          comment: source.comment,
          observedAt: new Date(source.observed_at).toISOString(),
          tagCodes: source.tag_codes,
        })),
      });
    } catch {
      throw new ServiceUnavailableException('ระบบสรุปอัตโนมัติยังไม่พร้อมใช้งาน');
    }
    this.assertOutput(output, sources);
    const row = await this.repository.withTransaction(async (runner) => {
      const created = await this.repository.createSummary(
        {
          studentUuid,
          schoolId: enrollment.school_id,
          actorId: actor.id,
          fingerprint,
          output,
        },
        sources,
        runner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actor.id,
          actorLabel: actor.username,
          action: 'STUDENT_OBSERVATION_UPDATE',
          targetType: 'student_observation_summaries',
          targetId: created.id,
          metadata: {
            schoolId: enrollment.school_id,
            studentTermId: studentUuid,
            summaryOperation: 'GENERATE',
            sourceCount: sources.length,
          },
          ip: null,
        },
        runner,
      );
      return created;
    });
    return { data: this.response(row), reused: false };
  }

  async get(studentUuid: string, actor: AuthenticatedRequestUser) {
    const enrollment = await this.access(studentUuid, actor);
    const row = await this.repository.findLatest(studentUuid);
    if (!row)
      return { data: null, generation: { available: false, reason: 'DISABLED_OR_NOT_GENERATED' } };
    const sources = await this.repository.listSources(
      studentUuid,
      enrollment.school_id,
      row.citations.map((citation) => citation.observationId),
    );
    const stale =
      row.is_stale ||
      sources.length !== row.citations.length ||
      this.fingerprint(sources) !== row.input_fingerprint;
    if (stale && !row.is_stale) await this.repository.markStale(row.id);
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_observation_summaries',
      targetId: row.id,
      metadata: {
        schoolId: enrollment.school_id,
        studentTermId: studentUuid,
        summaryOperation: 'VIEW',
        stale,
      },
      ip: null,
    });
    return {
      data: this.response(row, stale),
      generation: { available: false, reason: 'PROVIDER_NOT_CONFIGURED' },
    };
  }

  async review(
    studentUuid: string,
    summaryId: string,
    dto: ReviewObservationSummaryDto,
    actor: AuthenticatedRequestUser,
  ) {
    await this.access(studentUuid, actor);
    if (dto.decision === 'REJECTED' && !dto.note?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลเมื่อปฏิเสธสรุป');
    }
    const label =
      [actor.FirstName, actor.LastName].filter(Boolean).join(' ').trim() || actor.username;
    return await this.repository.withTransaction(async (runner) => {
      const row = await this.repository.review(
        summaryId,
        studentUuid,
        {
          decision: dto.decision,
          actorId: actor.id,
          actorLabel: label,
          note: dto.note?.trim() || null,
        },
        runner,
      );
      if (!row) throw new ConflictException('สรุปนี้ถูกตรวจแล้วหรือไม่พบข้อมูล');
      if (row.is_stale) throw new ConflictException('สรุปนี้ล้าสมัย กรุณาสร้างใหม่ก่อนตรวจ');
      await this.auditLog.recordAtomic(
        {
          actorUserId: actor.id,
          actorLabel: label,
          action: 'STUDENT_OBSERVATION_UPDATE',
          targetType: 'student_observation_summaries',
          targetId: row.id,
          metadata: {
            schoolId: row.school_id,
            studentTermId: studentUuid,
            summaryOperation: 'REVIEW',
            decision: dto.decision,
          },
          ip: null,
        },
        runner,
      );
      return { data: this.response(row) };
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isClassInScope, resolveActorDataScope, type AuthenticatedRequestUser } from '../auth';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import type { SchoolTermStatus } from './attendance-operations.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TERM_DAYS = 401;
@Injectable()
export class AttendanceOperationsService {
  private readonly logger = new Logger(AttendanceOperationsService.name);

  constructor(
    private readonly repository: AttendanceOperationsRepository,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  private async enqueueRiskProfileRefresh(reason: string): Promise<void> {
    await this.riskProfileService?.enqueueFull(reason).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to enqueue term risk profile recalculation: ${message}`);
    });
  }

  async listTerms(schoolId: number, actor?: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(schoolId, actor);
    const rows = await this.repository.listTerms(schoolId);
    return {
      data: rows.map((row) => ({
        id: row.id,
        schoolId: row.school_id,
        schoolName: row.school_name,
        academicYear: row.academic_year,
        semester: row.semester,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        status: row.status,
      })),
    };
  }

  async upsertTerm(
    input: {
      termId?: number;
      schoolId: number;
      academicYear: number;
      semester: number;
      startsOn: string;
      endsOn: string;
      status: SchoolTermStatus;
    },
    actor?: AuthenticatedRequestUser,
  ) {
    await this.assertTermAdmin(input.schoolId, actor);
    this.validateTermDates(input.startsOn, input.endsOn);
    try {
      const row = await this.repository.withTransaction(async (executor) => {
        const payload = { ...input, actorUserId: actor?.id ?? null };
        if (input.termId === undefined) {
          return await this.repository.upsertTerm(payload, executor);
        }
        const locked = await this.repository.findTermByIdForUpdate(input.termId, executor);
        if (!locked) throw new NotFoundException('ไม่พบภาคเรียน');
        if (locked.school_id !== input.schoolId) {
          throw new ForbiddenException('ภาคเรียนนี้ไม่ได้อยู่ในโรงเรียนที่เลือก');
        }
        const updated = await this.repository.updateTerm(input.termId, payload, executor);
        if (!updated) throw new NotFoundException('ไม่พบภาคเรียน');
        return updated;
      });
      await this.enqueueRiskProfileRefresh('school-term-change');
      return {
        data: {
          id: row.id,
          schoolId: row.school_id,
          schoolName: row.school_name,
          academicYear: row.academic_year,
          semester: row.semester,
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          status: row.status,
        },
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        // Two different unique rules can reject the same write; naming the wrong
        // one sends the user to fix a field that was never the problem.
        throw new ConflictException(
          this.violatedConstraint(error) === 'uq_school_terms_school_year_semester'
            ? 'โรงเรียนนี้มีภาคเรียนของปีและภาคเรียนนี้อยู่แล้ว'
            : 'โรงเรียนนี้มีภาคเรียนที่เปิดใช้งานอยู่แล้ว',
        );
      }
      throw error;
    }
  }

  async deleteTerm(termId: number, actor?: AuthenticatedRequestUser) {
    const term = await this.getTerm(termId);
    await this.assertTermAdmin(term.school_id, actor);
    try {
      const deletedId = await this.repository.withTransaction(async (executor) => {
        const locked = await this.repository.findTermByIdForUpdate(termId, executor);
        if (!locked) throw new NotFoundException('ไม่พบภาคเรียน');
        if (locked.status !== 'DRAFT') {
          throw new ConflictException('ลบได้เฉพาะภาคเรียนสถานะร่างที่ยังไม่ถูกใช้งาน');
        }
        const deleted = await this.repository.deleteTerm(termId, executor);
        if (!deleted) throw new NotFoundException('ไม่พบภาคเรียน');
        return deleted;
      });
      return { data: { id: deletedId } };
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException('ภาคเรียนนี้มีข้อมูลใช้งานแล้ว กรุณาปิดภาคเรียนแทนการลบ');
      }
      throw error;
    }
  }

  private async getTerm(termId: number) {
    const term = await this.repository.findTermById(termId);
    if (!term) throw new NotFoundException('ไม่พบภาคเรียน');
    return term;
  }

  private async assertSchoolAccess(
    schoolId: number,
    actor?: AuthenticatedRequestUser,
  ): Promise<void> {
    const allowed = await this.repository.isSchoolInScope(schoolId, resolveActorDataScope(actor));
    if (!allowed) throw new ForbiddenException('โรงเรียนอยู่นอกขอบเขตของคุณ');
  }

  /**
   * Scope check for endpoints whose only class input is a `classroomId`: the
   * classroom itself decides which school/grade/room the actor must be allowed
   * to see, so nothing about the caller's own scope is taken from the request.
   * Returns the resolved row so the caller can bind the rest of its payload to
   * it instead of trusting a client-supplied school or term.
   */
  async assertClassroomAccess(
    classroomId: number,
    actor?: AuthenticatedRequestUser,
  ): Promise<{ schoolId: number; schoolTermId: number }> {
    const classroom = await this.repository.findClassroomScope(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(Number(classroom.school_id), actor);
    this.assertClassScope(
      Number(classroom.grade_level_id),
      Number(classroom.legacy_room_number),
      actor,
    );
    return {
      schoolId: Number(classroom.school_id),
      schoolTermId: Number(classroom.school_term_id),
    };
  }

  private async assertTermAdmin(schoolId: number, actor?: AuthenticatedRequestUser): Promise<void> {
    await this.assertSchoolAccess(schoolId, actor);
    const scope = resolveActorDataScope(actor);
    if (scope?.grade_levels?.length || scope?.room_ids?.length) {
      throw new ForbiddenException('การจัดการภาคเรียนต้องใช้สิทธิ์ระดับโรงเรียนขึ้นไป');
    }
  }

  private assertClassScope(
    gradeLevelId: number,
    roomId: number,
    actor?: AuthenticatedRequestUser,
  ): void {
    if (!isClassInScope(resolveActorDataScope(actor), { gradeLevelId, roomId })) {
      throw new ForbiddenException('ชั้นเรียนหรือห้องเรียนอยู่นอกขอบเขตของคุณ');
    }
  }

  private validateTermDates(startsOn: string, endsOn: string): number {
    const start = Date.parse(`${startsOn}T00:00:00Z`);
    const end = Date.parse(`${endsOn}T00:00:00Z`);
    const normalizedStart = Number.isFinite(start)
      ? new Date(start).toISOString().slice(0, 10)
      : '';
    const normalizedEnd = Number.isFinite(end) ? new Date(end).toISOString().slice(0, 10) : '';
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      normalizedStart !== startsOn ||
      normalizedEnd !== endsOn ||
      start > end
    ) {
      throw new BadRequestException('ช่วงวันที่ภาคเรียนไม่ถูกต้อง');
    }
    const days = Math.floor((end - start) / DAY_MS) + 1;
    if (days > MAX_TERM_DAYS) {
      throw new BadRequestException('ช่วงภาคเรียนต้องไม่เกิน 401 วัน');
    }
    return days;
  }

  private violatedConstraint(error: unknown): string | null {
    if (typeof error !== 'object' || error === null || !('constraint' in error)) return null;
    const constraint = (error as { constraint?: unknown }).constraint;
    return typeof constraint === 'string' ? constraint : null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23503'
    );
  }
}

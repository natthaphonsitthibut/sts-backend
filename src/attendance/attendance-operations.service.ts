import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { resolveActorDataScope, type AuthenticatedRequestUser } from '../auth';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import type { CalendarDayType, SchoolTermStatus } from './attendance-operations.types';

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
      this.logger.error(`Failed to enqueue calendar risk profile recalculation: ${message}`);
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
        calendarDayCount: Number(row.calendar_day_count),
        schoolDayCount: Number(row.school_day_count),
      })),
    };
  }

  async upsertTerm(
    input: {
      schoolId: number;
      academicYear: number;
      semester: number;
      startsOn: string;
      endsOn: string;
      status: SchoolTermStatus;
    },
    actor?: AuthenticatedRequestUser,
  ) {
    await this.assertCalendarAdmin(input.schoolId, actor);
    const expectedDays = this.validateTermDates(input.startsOn, input.endsOn);
    try {
      const row = await this.repository.withTransaction(async (executor) => {
        const saved = await this.repository.upsertTerm(
          { ...input, actorUserId: actor?.id ?? null },
          executor,
        );
        if (input.status === 'ACTIVE') {
          const coverage = await this.repository.getCalendarCoverage(
            saved.id,
            input.startsOn,
            input.endsOn,
            executor,
          );
          if (coverage.calendarDayCount !== expectedDays || coverage.schoolDayCount < 1) {
            throw new BadRequestException(
              'ต้องสร้างปฏิทินให้ครบทุกวันในช่วงภาคเรียนก่อนเปิดใช้งาน',
            );
          }
        }
        return saved;
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
          calendarDayCount: Number(row.calendar_day_count),
          schoolDayCount: Number(row.school_day_count),
        },
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('โรงเรียนนี้มีภาคเรียนที่เปิดใช้งานอยู่แล้ว');
      }
      throw error;
    }
  }

  async generateCalendar(termId: number, schoolDays: number[], actor?: AuthenticatedRequestUser) {
    const term = await this.getTerm(termId);
    await this.assertCalendarAdmin(term.school_id, actor);
    if (!term.starts_on || !term.ends_on) {
      throw new BadRequestException('กรุณากำหนดวันเริ่มและวันสิ้นสุดภาคเรียนก่อน');
    }
    this.validateTermDates(term.starts_on, term.ends_on);
    await this.repository.withTransaction(async (executor) => {
      await this.repository.generateCalendar(termId, schoolDays, actor?.id ?? null, executor);
    });
    await this.enqueueRiskProfileRefresh('school-calendar-generate');
    return await this.listCalendar(termId, actor);
  }

  async listCalendar(termId: number, actor?: AuthenticatedRequestUser) {
    const term = await this.getTerm(termId);
    await this.assertSchoolAccess(term.school_id, actor);
    const rows = await this.repository.listCalendar(termId);
    return {
      data: rows.map((row) => ({
        id: row.id,
        termId: row.school_term_id,
        date: row.calendar_date,
        dayType: row.day_type,
        reason: row.reason,
        source: row.source,
      })),
    };
  }

  async updateCalendarDay(
    calendarDayId: number,
    dayType: CalendarDayType,
    reason: string | undefined,
    actor?: AuthenticatedRequestUser,
  ) {
    const day = await this.repository.findCalendarDayById(calendarDayId);
    if (!day) throw new NotFoundException('ไม่พบวันในปฏิทิน');
    const term = await this.getTerm(Number(day.school_term_id));
    await this.assertCalendarAdmin(term.school_id, actor);
    const updated = await this.repository.withTransaction(
      async (executor) =>
        await this.repository.updateCalendarDay(
          calendarDayId,
          dayType,
          reason?.trim() || null,
          actor?.id ?? null,
          executor,
        ),
    );
    if (!updated) throw new NotFoundException('ไม่พบวันในปฏิทิน');
    await this.enqueueRiskProfileRefresh('school-calendar-day-change');
    return {
      data: {
        id: updated.id,
        termId: updated.school_term_id,
        date: updated.calendar_date,
        dayType: updated.day_type,
        reason: updated.reason,
        source: updated.source,
      },
    };
  }

  async getSessionContext(
    schoolId: number,
    grade: string,
    room: number,
    date: string,
    actor?: AuthenticatedRequestUser,
    timetableSlotId?: number,
  ) {
    await this.assertSchoolAccess(schoolId, actor);
    const context = await this.repository.findSessionContext(
      schoolId,
      grade,
      room,
      date,
      timetableSlotId,
    );
    if (context.metadata) {
      this.assertClassScope(context.metadata.grade_level_id, room, actor);
    }
    return {
      data: {
        calendarConfigured: context.term?.status === 'ACTIVE',
        term: context.term
          ? {
              id: context.term.id,
              academicYear: context.term.academic_year,
              semester: context.term.semester,
              status: context.term.status,
            }
          : null,
        dayType: context.calendarDay?.day_type ?? null,
        expectedRosterCount: context.expectedRosterCount,
        session: context.session ? this.toSessionResponse(context.session) : null,
      },
    };
  }

  async reopenSession(sessionId: string, reason: string, actor?: AuthenticatedRequestUser) {
    const session = await this.repository.findSessionById(sessionId);
    if (!session) throw new NotFoundException('ไม่พบรอบเช็กชื่อ');
    await this.assertSchoolAccess(session.school_id, actor);
    this.assertClassScope(session.grade_level_id, session.room_id, actor);
    const updated = await this.repository.withTransaction(async (executor) => {
      const reopened = await this.repository.reopenSession(
        sessionId,
        reason.trim(),
        actor?.id ?? null,
        executor,
      );
      if (reopened) {
        const baselineStatuses = await this.repository.listSessionAttendanceStatuses(
          sessionId,
          executor,
        );
        await this.repository.recordSessionAudit(
          {
            action: 'ATTENDANCE_REOPEN',
            sessionId,
            actorUserId: actor?.id ?? null,
            actorLabel: actor?.username || (actor?.id ? `user#${actor.id}` : 'unknown-user'),
            metadata: {
              schoolId: reopened.school_id,
              gradeLevelId: reopened.grade_level_id,
              roomId: reopened.room_id,
              attendanceDate: reopened.attendance_date,
              revision: reopened.revision,
              reason: reason.trim(),
              baselineStatuses: baselineStatuses.map((row) => ({
                studentUuid: row.student_uuid,
                statusCode: row.attendance_status,
              })),
            },
          },
          executor,
        );
      }
      return reopened;
    });
    if (!updated) {
      throw new ConflictException('เปิดแก้ไขได้เฉพาะรอบที่ส่งเรียบร้อยแล้ว');
    }
    return { data: this.toSessionResponse(updated) };
  }

  async getReconciliation(
    termId: number,
    date: string,
    page: number,
    limit: number,
    actor?: AuthenticatedRequestUser,
    gradeLevelId?: number,
    room?: number,
  ) {
    const term = await this.getTerm(termId);
    await this.assertSchoolAccess(term.school_id, actor);
    if (term.starts_on && term.ends_on && (date < term.starts_on || date > term.ends_on)) {
      throw new BadRequestException('วันที่อยู่นอกช่วงภาคเรียน');
    }
    if (term.status !== 'ACTIVE') {
      throw new ConflictException('ต้องเปิดใช้งานภาคเรียนก่อนตรวจความครบถ้วน');
    }
    const calendarDay = await this.repository.findCalendarDay(term.id, date);
    if (!calendarDay) {
      throw new ConflictException('ปฏิทินภาคเรียนไม่ครบสำหรับวันที่เลือก');
    }
    if (calendarDay && calendarDay.day_type !== 'SCHOOL_DAY') {
      return {
        rows: [],
        totalCount: 0,
        page,
        limit,
        dayType: calendarDay.day_type,
        summary: { completed: 0, missing: 0, incomplete: 0 },
      };
    }
    const result = await this.repository.listReconciliation(
      term,
      date,
      resolveActorDataScope(actor),
      page,
      limit,
      gradeLevelId,
      room,
    );
    return {
      rows: result.rows.map((row) => ({
        gradeLevelId: row.grade_level_id,
        grade: row.grade_label,
        room: row.room_id,
        expectedRosterCount: row.expected_roster_count,
        recordedCount: row.recorded_count,
        sessionId: row.session_id,
        sessionStatus: row.session_status,
        revision: row.revision,
        operationalStatus: row.operational_status,
      })),
      totalCount: result.totalCount,
      page,
      limit,
      dayType: calendarDay?.day_type ?? null,
      summary: result.summary,
    };
  }

  async getReconciliationAnomalies(
    termId: number,
    page: number,
    limit: number,
    actor?: AuthenticatedRequestUser,
    gradeLevelId?: number,
    room?: number,
  ) {
    const term = await this.getTerm(termId);
    await this.assertSchoolAccess(term.school_id, actor);
    if (term.status !== 'ACTIVE') {
      throw new ConflictException('ต้องเปิดใช้งานภาคเรียนก่อนตรวจรายการผิดปกติ');
    }
    const result = await this.repository.listSessionAnomalies(
      term,
      resolveActorDataScope(actor),
      page,
      limit,
      gradeLevelId,
      room,
    );
    return {
      rows: result.rows.map((row) => ({
        sessionId: row.session_id,
        date: row.attendance_date,
        gradeLevelId: row.grade_level_id,
        grade: row.grade_label ?? `ชั้น ${row.grade_level_id}`,
        room: row.room_id,
        expectedRosterCount: row.expected_roster_count,
        recordedCount: row.recorded_count,
        sessionStatus: row.session_status,
        revision: row.revision,
        dayType: row.day_type,
        calendarReason: row.calendar_reason,
        anomalyType: row.anomaly_type,
      })),
      totalCount: result.totalCount,
      page,
      limit,
      summary: result.summary,
    };
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

  private async assertCalendarAdmin(
    schoolId: number,
    actor?: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.assertSchoolAccess(schoolId, actor);
    const scope = resolveActorDataScope(actor);
    if (scope?.grade_levels?.length || scope?.room_ids?.length) {
      throw new ForbiddenException('การตั้งปฏิทินต้องใช้สิทธิ์ระดับโรงเรียนขึ้นไป');
    }
  }

  private assertClassScope(
    gradeLevelId: number,
    roomId: number,
    actor?: AuthenticatedRequestUser,
  ): void {
    const scope = resolveActorDataScope(actor);
    if (scope?.grade_levels?.length && !scope.grade_levels.includes(gradeLevelId)) {
      throw new ForbiddenException('ชั้นเรียนอยู่นอกขอบเขตของคุณ');
    }
    if (scope?.room_ids?.length && !scope.room_ids.map(String).includes(String(roomId))) {
      throw new ForbiddenException('ห้องเรียนอยู่นอกขอบเขตของคุณ');
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private toSessionResponse(session: {
    id: string;
    status: string;
    revision: number;
    expected_roster_count: number;
    recorded_count: number;
    submitted_at: string | Date | null;
    correction_reason: string | null;
  }) {
    return {
      id: session.id,
      status: session.status,
      revision: session.revision,
      expectedRosterCount: session.expected_roster_count,
      recordedCount: session.recorded_count,
      submittedAt: session.submitted_at,
      correctionReason: session.correction_reason,
    };
  }
}

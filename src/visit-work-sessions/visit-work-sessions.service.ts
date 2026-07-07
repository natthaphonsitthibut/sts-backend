import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { TaskAccessService } from '../task/task-access.service';
import type { AuthenticatedRequestUser } from '../auth';
import type { EndWorkSessionDto } from './dto/visit-work-sessions.dto';
import { VisitWorkSessionsRepository, type MonitorFilters } from './visit-work-sessions.repository';
import type { WorkSessionEndReason } from './visit-work-sessions.types';

const PING_INTERVAL_SECONDS = 30;
const TIMEOUT_MINUTES = 30;
const PING_RETENTION_DAYS = 7;
const TIMEOUT_CRON = '0 */5 * * * *';
const PING_RETENTION_CRON = '0 50 3 * * *';

@Injectable()
export class VisitWorkSessionsService {
  private readonly logger = new Logger(VisitWorkSessionsService.name);

  constructor(
    private readonly repository: VisitWorkSessionsRepository,
    private readonly taskAccessService: TaskAccessService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Same fail-closed shape as TaskSubmissionService.validateUsableLink — the
   * magic-link token is the only credential here, so every write re-validates
   * expiry/admin-lock/completion/OTP before touching a row. Work sessions
   * only make sense for VISIT-type (home-visit) tasks.
   */
  private validateUsableLink(
    task: Awaited<ReturnType<TaskAccessService['getTaskByToken']>>,
  ): Record<string, unknown> {
    if (!task) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }
    const link = task;
    if (link.error) {
      const status = typeof link.status === 'string' ? link.status : '';
      const message = typeof link.error === 'string' ? link.error : 'ลิงก์ใช้งานไม่ได้';
      if (status === 'EXPIRED') throw new GoneException(message);
      if (status === 'ADMIN_LOCKED') throw new ForbiddenException(message);
      if (status === 'COMPLETED' || status === 'DELEGATED') throw new ConflictException(message);
      throw new BadRequestException(message);
    }
    if (link.task_type !== 'VISIT') {
      throw new ForbiddenException('ลิงก์นี้ไม่รองรับการปฏิบัติงานภาคสนาม');
    }
    if (link.auth_required === true) {
      throw new ForbiddenException('กรุณายืนยัน OTP ก่อนเริ่มปฏิบัติงาน');
    }
    return link;
  }

  /** Lets the guest page resume correctly after a reload mid-fieldwork. */
  async getStatus(token: string, sessionToken?: string) {
    const task = await this.taskAccessService.getTaskByToken(token, sessionToken);
    const link = this.validateUsableLink(task);
    const linkId = String(link.link_id);

    const session = await this.repository.findOpenSessionByLinkId(linkId);
    return {
      success: true,
      session: session
        ? {
            id: session.id,
            started_at: session.started_at,
            ping_interval_seconds: PING_INTERVAL_SECONDS,
          }
        : null,
    };
  }

  async startSession(token: string, consent: boolean, sessionToken?: string) {
    if (!consent) {
      throw new BadRequestException('ต้องยินยอมก่อนเริ่มปฏิบัติงาน');
    }
    const task = await this.taskAccessService.getTaskByToken(token, sessionToken);
    const link = this.validateUsableLink(task);
    const linkId = String(link.link_id);

    const existing = await this.repository.findOpenSessionByLinkId(linkId);
    if (existing) {
      throw new ConflictException('มีช่วงปฏิบัติงานที่เปิดอยู่แล้วสำหรับงานนี้');
    }

    const session = await this.repository.startSession(linkId, new Date());
    await this.auditLog.record({
      action: 'WORK_SESSION_START',
      actorUserId: null,
      actorLabel: 'guest',
      targetType: 'visit_work_session',
      targetId: session.id,
      metadata: { taskLinkId: linkId },
      ip: null,
    });

    return {
      success: true,
      session: {
        id: session.id,
        started_at: session.started_at,
        ping_interval_seconds: PING_INTERVAL_SECONDS,
      },
    };
  }

  async endSession(token: string, dto: EndWorkSessionDto, sessionToken?: string) {
    const task = await this.taskAccessService.getTaskByToken(token, sessionToken);
    const link = this.validateUsableLink(task);
    const linkId = String(link.link_id);
    const reason: WorkSessionEndReason = dto.reason ?? 'MANUAL';

    const session = await this.repository.endOpenSessionByLinkId(linkId, reason);
    if (!session) {
      throw new ConflictException('ไม่มีช่วงปฏิบัติงานที่เปิดอยู่สำหรับงานนี้');
    }

    await this.auditLog.record({
      action: 'WORK_SESSION_END',
      actorUserId: null,
      actorLabel: 'guest',
      targetType: 'visit_work_session',
      targetId: session.id,
      metadata: { taskLinkId: linkId, endReason: reason },
      ip: null,
    });

    return { success: true, session: { id: session.id, ended_at: session.ended_at } };
  }

  async recordPosition(token: string, lat: number, lng: number, sessionToken?: string) {
    const task = await this.taskAccessService.getTaskByToken(token, sessionToken);
    const link = this.validateUsableLink(task);
    const linkId = String(link.link_id);

    const openSession = await this.repository.findOpenSessionByLinkId(linkId);
    if (!openSession) {
      throw new ConflictException(
        'ไม่มีช่วงปฏิบัติงานที่เปิดอยู่ กรุณาเริ่มปฏิบัติงานก่อนส่งตำแหน่ง',
      );
    }

    const inserted = await this.repository.insertPingIfOpen(openSession.id, lat, lng);
    if (!inserted) {
      // Session closed in the race between the check above and this insert.
      throw new ConflictException('ช่วงปฏิบัติงานถูกปิดไปแล้ว');
    }

    return { success: true };
  }

  async listForMonitor(actor: AuthenticatedRequestUser, filters: MonitorFilters = {}) {
    const scope = actor.data_scope ?? {};
    if (scope.own_only === true) {
      await this.recordMonitorView(actor, 0);
      return { success: true, active: [], recentlyEnded: [] };
    }

    const [active, recentlyEnded] = await Promise.all([
      this.repository.listActiveForMonitor(scope, filters),
      this.repository.listRecentlyEnded(scope, 20, filters),
    ]);
    await this.recordMonitorView(actor, active.length);

    return { success: true, active, recentlyEnded };
  }

  private async recordMonitorView(
    actor: AuthenticatedRequestUser,
    activeCount: number,
  ): Promise<void> {
    await this.auditLog.record({
      action: 'WORK_SESSION_VIEW',
      actorUserId: actor.id,
      actorLabel: actor.username,
      targetType: 'visit_work_session',
      targetId: null,
      metadata: { activeCount },
      ip: null,
    });
  }

  /** Closes sessions with no ping (or no ping since start) in the last 30 minutes. */
  async closeTimedOutSessions(now = new Date()): Promise<{ closed: number }> {
    const cutoff = new Date(now.getTime() - TIMEOUT_MINUTES * 60 * 1000);
    const closed = await this.repository.claimTimedOutSessions(cutoff);
    return { closed: closed.length };
  }

  @Cron(TIMEOUT_CRON, { timeZone: BANGKOK_TIME_ZONE, name: 'visit_work_session_timeout' })
  async runTimeoutCheck(): Promise<void> {
    try {
      const { closed } = await this.closeTimedOutSessions();
      if (closed > 0) {
        this.logger.log(
          `Closed ${closed} work session(s) as TIMEOUT (no ping in ${TIMEOUT_MINUTES}m).`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Work session timeout check failed: ${message}`);
    }
  }

  /** Deletes position pings older than 7 days — session metadata itself is kept permanently. */
  async cleanupExpiredPings(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - PING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.repository.deletePingsOlderThan(cutoff);
    return { deleted };
  }

  @Cron(PING_RETENTION_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'visit_position_ping_retention_cleanup',
  })
  async runPingRetentionCleanup(): Promise<void> {
    try {
      const { deleted } = await this.cleanupExpiredPings();
      if (deleted > 0) {
        this.logger.log(
          `Deleted ${deleted} position ping(s) older than ${PING_RETENTION_DAYS} days.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Position ping retention cleanup failed: ${message}`);
    }
  }
}

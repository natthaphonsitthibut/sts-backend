import { BadRequestException, ConflictException, GoneException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskAccessService } from '../task/task-access.service';
import { VisitWorkSessionsRepository } from './visit-work-sessions.repository';
import { VisitWorkSessionsService } from './visit-work-sessions.service';
import type { VisitWorkSessionRow } from './visit-work-sessions.types';

describe('VisitWorkSessionsService', () => {
  let service: VisitWorkSessionsService;
  let repository: jest.Mocked<
    Pick<
      VisitWorkSessionsRepository,
      | 'findOpenSessionByLinkId'
      | 'startSession'
      | 'endOpenSessionByLinkId'
      | 'insertPingIfOpen'
      | 'listActiveForMonitor'
      | 'listRecentlyEnded'
      | 'claimTimedOutSessions'
      | 'deletePingsOlderThan'
    >
  >;
  let taskAccessService: jest.Mocked<Pick<TaskAccessService, 'getTaskByToken'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  const activeLink = {
    link_id: 'link-1',
    task_type: 'VISIT',
    auth_required: false,
  };

  function sessionRow(overrides: Partial<VisitWorkSessionRow> = {}): VisitWorkSessionRow {
    return {
      id: '1',
      task_link_id: 'link-1',
      started_at: new Date('2026-07-07T00:00:00Z'),
      ended_at: null,
      end_reason: null,
      consent_at: new Date('2026-07-07T00:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      findOpenSessionByLinkId: jest.fn().mockResolvedValue(null),
      startSession: jest.fn().mockResolvedValue(sessionRow()),
      endOpenSessionByLinkId: jest
        .fn()
        .mockResolvedValue(sessionRow({ ended_at: new Date(), end_reason: 'MANUAL' })),
      insertPingIfOpen: jest.fn().mockResolvedValue(true),
      listActiveForMonitor: jest.fn().mockResolvedValue([]),
      listRecentlyEnded: jest.fn().mockResolvedValue([]),
      claimTimedOutSessions: jest.fn().mockResolvedValue([]),
      deletePingsOlderThan: jest.fn().mockResolvedValue(0),
    };
    taskAccessService = { getTaskByToken: jest.fn().mockResolvedValue(activeLink) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new VisitWorkSessionsService(
      repository as unknown as VisitWorkSessionsRepository,
      taskAccessService as unknown as TaskAccessService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('getStatus', () => {
    it('returns session: null when no session is open', async () => {
      const result = await service.getStatus('token', undefined);
      expect(result).toEqual({ success: true, session: null });
    });

    it('returns the open session with the ping interval', async () => {
      repository.findOpenSessionByLinkId.mockResolvedValue(sessionRow());
      const result = await service.getStatus('token', undefined);
      expect(result).toEqual({
        success: true,
        session: {
          id: '1',
          started_at: sessionRow().started_at,
          ping_interval_seconds: 30,
        },
      });
    });
  });

  describe('startSession', () => {
    it('rejects when consent is false', async () => {
      await expect(service.startSession('token', false, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.startSession).not.toHaveBeenCalled();
    });

    it('rejects an expired link', async () => {
      taskAccessService.getTaskByToken.mockResolvedValue({
        error: 'Link expired',
        status: 'EXPIRED',
      });
      await expect(service.startSession('token', true, undefined)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('rejects when a session is already open for the link', async () => {
      repository.findOpenSessionByLinkId.mockResolvedValue(sessionRow());
      await expect(service.startSession('token', true, undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repository.startSession).not.toHaveBeenCalled();
    });

    it('starts a session and audits WORK_SESSION_START with the link ref only', async () => {
      const result = await service.startSession('token', true, 'session-token');

      expect(repository.startSession).toHaveBeenCalledWith('link-1', expect.any(Date));
      expect(result.session.ping_interval_seconds).toBe(30);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WORK_SESSION_START',
          actorUserId: null,
          metadata: { taskLinkId: 'link-1' },
        }),
      );
    });
  });

  describe('endSession', () => {
    it('rejects when no open session exists', async () => {
      repository.endOpenSessionByLinkId.mockResolvedValue(null);
      await expect(service.endSession('token', {}, undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('defaults to MANUAL and audits WORK_SESSION_END', async () => {
      await service.endSession('token', {}, undefined);

      expect(repository.endOpenSessionByLinkId).toHaveBeenCalledWith('link-1', 'MANUAL');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WORK_SESSION_END',
          metadata: { taskLinkId: 'link-1', endReason: 'MANUAL' },
        }),
      );
    });

    it('passes through an explicit SUBMITTED reason', async () => {
      await service.endSession('token', { reason: 'SUBMITTED' }, undefined);

      expect(repository.endOpenSessionByLinkId).toHaveBeenCalledWith('link-1', 'SUBMITTED');
    });
  });

  describe('recordPosition', () => {
    it('rejects when there is no open session', async () => {
      repository.findOpenSessionByLinkId.mockResolvedValue(null);
      await expect(service.recordPosition('token', 18.7, 98.9, undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repository.insertPingIfOpen).not.toHaveBeenCalled();
    });

    it('rejects (fail-closed) when the session closed in the race before insert', async () => {
      repository.findOpenSessionByLinkId.mockResolvedValue(sessionRow());
      repository.insertPingIfOpen.mockResolvedValue(false);
      await expect(service.recordPosition('token', 18.7, 98.9, undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('records the ping for an open session', async () => {
      repository.findOpenSessionByLinkId.mockResolvedValue(sessionRow());
      const result = await service.recordPosition('token', 18.7, 98.9, undefined);

      expect(repository.insertPingIfOpen).toHaveBeenCalledWith('1', 18.7, 98.9);
      expect(result).toEqual({ success: true });
    });
  });

  describe('listForMonitor', () => {
    const actor = {
      id: 5,
      username: 'director1',
      roles: ['DIRECTOR'],
      permissions: ['field-monitor'],
      data_scope: { global: true },
    };

    it('fails closed for own_only without querying the repository', async () => {
      const result = await service.listForMonitor({ ...actor, data_scope: { own_only: true } });

      expect(result).toEqual({ success: true, active: [], recentlyEnded: [] });
      expect(repository.listActiveForMonitor).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WORK_SESSION_VIEW', metadata: { activeCount: 0 } }),
      );
    });

    it('lists active + recently-ended sessions and audits the view with a count', async () => {
      repository.listActiveForMonitor.mockResolvedValue([
        { session_id: '1', task_link_id: 'link-1' } as never,
      ]);

      const result = await service.listForMonitor(actor);

      expect(result.active).toHaveLength(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WORK_SESSION_VIEW', metadata: { activeCount: 1 } }),
      );
    });
  });

  describe('crons', () => {
    it('closeTimedOutSessions uses a cutoff 30 minutes before now', async () => {
      const now = new Date('2026-07-07T10:00:00Z');
      await service.closeTimedOutSessions(now);

      const cutoff = repository.claimTimedOutSessions.mock.calls[0][0];
      expect(cutoff.getTime()).toBe(now.getTime() - 30 * 60 * 1000);
    });

    it('cleanupExpiredPings uses a cutoff 7 days before now', async () => {
      const now = new Date('2026-07-07T10:00:00Z');
      await service.cleanupExpiredPings(now);

      const cutoff = repository.deletePingsOlderThan.mock.calls[0][0];
      expect(cutoff.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    });
  });
});

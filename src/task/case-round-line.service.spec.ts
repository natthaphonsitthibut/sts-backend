import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { CaseRoundLineService } from './case-round-line.service';

const ACTOR = {
  id: 7,
  username: 'school-admin',
  roles: ['S1_BASE_ADMIN'],
  permissions: ['dashboard'],
  data_scope: { school_ids: [1] },
};

const LINK = {
  id: '11111111-1111-4111-8111-111111111111',
  task_id: '22222222-2222-4222-8222-222222222222',
  status: 'ACTIVE',
  expires_at: '2026-09-29T06:38:00.000Z',
  assigned_teacher_id: '41',
  task_type: 'VISIT',
  student_name: 'ด.ญ. ทดสอบ ส่งไลน์',
  student_school: 'โรงเรียนบูรพา',
  line_provider_user_id: 'U0123',
  line_friend_state: 'FRIEND',
  magic_link: 'https://sts.example/task/abc',
};

function setup(overrides: { link?: Partial<typeof LINK> | null; enabled?: boolean } = {}) {
  const repository = {
    findCaseById: jest.fn().mockResolvedValue({ id: 5 }),
    findRoundLinkForLine: jest
      .fn()
      .mockResolvedValue(overrides.link === null ? null : { ...LINK, ...overrides.link }),
    recordRoundLineNotReady: jest.fn().mockResolvedValue(undefined),
    claimRoundLine: jest.fn().mockResolvedValue(true),
    finishRoundLine: jest.fn().mockResolvedValue(undefined),
  };
  const messaging = {
    isEnabled: jest.fn().mockReturnValue(overrides.enabled ?? true),
    sendMessages: jest.fn().mockResolvedValue([{ providerUserId: 'U0123', delivered: true }]),
  };
  const policy = { ensureActor: jest.fn((actor: unknown) => actor) };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CaseRoundLineService(
    repository as never,
    policy as never,
    auditLog as never,
    messaging as never,
  );
  return { service, repository, messaging, auditLog };
}

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

describe('CaseRoundLineService', () => {
  it("sends the round's own link to the assigned teacher once", async () => {
    const { service, repository, messaging } = setup();

    await expect(service.send(5, LINK.task_id, REQUEST_ID, ACTOR as never)).resolves.toMatchObject({
      data: { status: 'SENT' },
    });
    const [[messages, retryKey]] = messaging.sendMessages.mock.calls as [
      [Array<{ providerUserId: string; text: string }>, string],
    ];
    expect(messages).toHaveLength(1);
    expect(messages[0].providerUserId).toBe('U0123');
    expect(messages[0].text).toContain('https://sts.example/task/abc');
    expect(messages[0].text).toContain('ด.ญ. ทดสอบ ส่งไลน์');
    expect(retryKey).toBe(`case-round-${REQUEST_ID}`);
    expect(repository.claimRoundLine).toHaveBeenCalledWith(LINK.id, '41', REQUEST_ID, 7);
    expect(repository.finishRoundLine).toHaveBeenCalledWith(LINK.id, REQUEST_ID, true, 7);
  });

  it('never sends while the same request is already claimed', async () => {
    const { service, repository, messaging } = setup();
    repository.claimRoundLine.mockResolvedValue(false);

    await expect(service.send(5, LINK.task_id, REQUEST_ID, ACTOR as never)).resolves.toMatchObject({
      data: { status: 'SENDING' },
    });
    expect(messaging.sendMessages).not.toHaveBeenCalled();
  });

  it.each([
    [{ line_provider_user_id: null }, true, 'ACCOUNT_NOT_VERIFIED'],
    [{ line_friend_state: 'BLOCKED' }, true, 'ACCOUNT_NOT_REACHABLE'],
    [{ assigned_teacher_id: null }, true, 'ASSIGNEE_UNAVAILABLE'],
    [{}, false, 'MESSAGING_DISABLED'],
  ])('records why it cannot send (%o, enabled=%s)', async (link, enabled, code) => {
    const { service, repository, messaging } = setup({ link, enabled });

    await expect(service.send(5, LINK.task_id, REQUEST_ID, ACTOR as never)).resolves.toMatchObject({
      data: { status: 'NOT_READY', failure_code: code },
    });
    expect(repository.recordRoundLineNotReady).toHaveBeenCalled();
    expect(messaging.sendMessages).not.toHaveBeenCalled();
  });

  it('marks a provider failure so it can be retried', async () => {
    const { service, repository, messaging } = setup();
    messaging.sendMessages.mockRejectedValue(new Error('LINE down'));

    await expect(service.send(5, LINK.task_id, REQUEST_ID, ACTOR as never)).resolves.toMatchObject({
      data: { status: 'FAILED', failure_code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(repository.finishRoundLine).toHaveBeenCalledWith(LINK.id, REQUEST_ID, false, 7);
  });

  it('keeps the case scope and a closed link out of reach', async () => {
    const outOfScope = setup();
    outOfScope.repository.findCaseById.mockResolvedValue(null);
    await expect(
      outOfScope.service.send(5, LINK.task_id, REQUEST_ID, ACTOR as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    const closed = setup({ link: null });
    await expect(
      closed.service.send(5, LINK.task_id, REQUEST_ID, ACTOR as never),
    ).rejects.toBeInstanceOf(GoneException);

    const executive = setup();
    await expect(
      executive.service.send(5, LINK.task_id, REQUEST_ID, {
        ...ACTOR,
        roles: ['EXECUTIVE'],
        permissions: ['dashboard'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

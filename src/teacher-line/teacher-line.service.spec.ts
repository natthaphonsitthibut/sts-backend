import {
  BadRequestException,
  ConflictException,
  GoneException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { TeacherLineRepository } from './teacher-line.repository';
import { TeacherLineService } from './teacher-line.service';

const TEACHER = {
  teacher_id: '7',
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  email: 'somchai@school.ac.th',
};

const IDENTITY = { providerUserId: 'U0000000000000000000000000000001', displayName: 'Somchai' };
const GROUP_TOKEN = 'b'.repeat(64);
const INVITATION = {
  id: '11111111-1111-4111-8111-111111111111',
  teacher_membership_id: '12',
  teacher_id: TEACHER.teacher_id,
  school_id: 10,
  first_name: TEACHER.first_name,
  last_name: TEACHER.last_name,
  email: TEACHER.email,
  token_hash: 'a'.repeat(64),
  issued_by: 1,
  issued_at: new Date(Date.now() - 60_000).toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  consumed_at: null,
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
  teacher_status: 'ACTIVE',
  membership_status: 'ACTIVE',
  membership_deleted_at: null,
};

const GROUP_INVITATION = {
  id: '22222222-2222-4222-8222-222222222222',
  school_id: 7,
  school_name: 'โรงเรียนทดสอบ',
  token_hash: 'b'.repeat(64),
  token_encrypted: `encrypted:${GROUP_TOKEN}`,
  issued_by: 1,
  issued_at: new Date(Date.now() - 60_000).toISOString(),
  starts_at: new Date(Date.now() - 60_000).toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
};

function createHarness() {
  const repository = {
    withTransaction: jest.fn(async (operation: (runner: QueryRunner) => Promise<unknown>) =>
      operation({} as QueryRunner),
    ),
    findActiveTeacherByEmail: jest.fn().mockResolvedValue(TEACHER),
    findActiveTeacherByCitizenId: jest.fn().mockResolvedValue(TEACHER),
    findActiveAccountForTeacher: jest.fn().mockResolvedValue(null),
    hasActiveAccountForTeacher: jest.fn().mockResolvedValue(false),
    findActiveAccountByProviderUser: jest.fn().mockResolvedValue(null),
    hasActiveTeacherMembership: jest.fn().mockResolvedValue(true),
    unlinkAccount: jest.fn().mockResolvedValue(undefined),
    unlinkActiveAccountForTeacher: jest.fn().mockResolvedValue(true),
    insertAccount: jest.fn().mockResolvedValue('1'),
    updateFriendState: jest.fn().mockResolvedValue(undefined),
    createInvitation: jest.fn().mockResolvedValue({
      id: INVITATION.id,
      expires_at: INVITATION.expires_at,
    }),
    findInvitationByTokenHash: jest.fn().mockResolvedValue(INVITATION),
    findInvitationById: jest.fn().mockResolvedValue(INVITATION),
    revokeActiveInvitation: jest.fn().mockResolvedValue(true),
    consumeInvitation: jest.fn().mockResolvedValue(true),
    createGroupInvitation: jest.fn().mockResolvedValue(GROUP_INVITATION),
    findActiveGroupInvitationByTokenHash: jest.fn().mockResolvedValue(GROUP_INVITATION),
    findActiveGroupInvitationForSchool: jest.fn().mockResolvedValue(GROUP_INVITATION),
    updateActiveGroupInvitation: jest.fn().mockResolvedValue(true),
    revokeActiveGroupInvitation: jest.fn().mockResolvedValue(true),
  };
  const sessionStore = {
    createBindingSession: jest.fn().mockResolvedValue('binding-token'),
    readBindingSession: jest.fn().mockResolvedValue({
      teacherId: TEACHER.teacher_id,
    }),
    clearBindingSession: jest.fn().mockResolvedValue(undefined),
    createOAuthState: jest.fn().mockResolvedValue('state-value'),
    consumeOAuthState: jest.fn().mockResolvedValue({
      bindingToken: 'binding-token',
      teacherId: TEACHER.teacher_id,
      nonce: 'nonce-value',
    }),
  };
  const otpStore = {
    issue: jest.fn().mockResolvedValue(new Date()),
    verify: jest.fn().mockResolvedValue('ok'),
  };
  const emailService = { sendOTP: jest.fn().mockResolvedValue({ success: true }) };
  const araIdService = {
    getVerifiedIdentityNumber: jest.fn().mockResolvedValue('1101700200018'),
  };
  const araIdChallengeStore = {
    create: jest.fn(),
    read: jest.fn(),
    claimOrRenew: jest.fn(),
    readAuthorization: jest.fn(),
    approveAuthorization: jest.fn(),
    consumeApproved: jest.fn(),
  };
  const auditLog = {
    record: jest.fn().mockResolvedValue(undefined),
    recordAtomic: jest.fn().mockResolvedValue(undefined),
  };
  const tokenEncryption = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string) => value.replace(/^encrypted:/, '')),
  };
  const messaging = {
    isEnabled: jest.fn().mockReturnValue(true),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://access.line.me/authorize'),
    buildAddContactUrl: jest.fn().mockReturnValue('https://line.me/R/ti/p/@sts'),
    completeAuthorization: jest
      .fn()
      .mockResolvedValue({ identity: IDENTITY, friendState: 'FRIEND' }),
    readFriendState: jest.fn(),
    sendMessages: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };
  const service = new TeacherLineService(
    repository as unknown as TeacherLineRepository,
    sessionStore as never,
    tokenEncryption as never,
    otpStore as never,
    emailService as never,
    auditLog as never,
    araIdService as never,
    araIdChallengeStore as never,
    messaging,
    { messagingChannelId: '2000000002', invitationTtlHours: 24 } as never,
    { frontendBaseUrl: 'https://sts.test' } as never,
    { otpTtlSeconds: 600 } as never,
  );
  return {
    service,
    repository,
    sessionStore,
    otpStore,
    emailService,
    auditLog,
    araIdService,
    araIdChallengeStore,
    messaging,
    tokenEncryption,
  };
}

describe('TeacherLineService', () => {
  it('issues one expiring group link without teacher identity in the URL', async () => {
    const { service } = createHarness();
    const result = await service.issueGroupInvitation({
      schoolId: 7,
      schoolName: 'โรงเรียนทดสอบ',
      issuedBy: 1,
      startsAt: new Date(Date.now()),
      expiresAt: new Date(Date.now() + 86_400_000),
      baseUrl: 'https://sts.test',
    });

    expect(result.url).toContain('/line-link#token=');
    expect(result.schoolName).toBe('โรงเรียนทดสอบ');
    expect(result.url).not.toContain(TEACHER.email);
    expect(result.expiresAt).toBeTruthy();
  });

  it('rebuilds an active shared URL from the persisted encrypted token', async () => {
    const { service, tokenEncryption } = createHarness();

    await expect(service.getActiveGroupInvitation(7, 'https://sts.test')).resolves.toMatchObject({
      id: GROUP_INVITATION.id,
      url: `https://sts.test/line-link#token=${GROUP_TOKEN}`,
    });
    expect(tokenEncryption.decrypt).toHaveBeenCalledWith(GROUP_INVITATION.token_encrypted);
  });

  it('rejects group OTP requests after the shared link expires', async () => {
    const { service, repository, emailService } = createHarness();
    repository.findActiveGroupInvitationByTokenHash.mockResolvedValue(null);

    await expect(service.requestOtp(TEACHER.email, null, GROUP_TOKEN)).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(emailService.sendOTP).not.toHaveBeenCalled();
  });

  it('answers the same way whether or not the address belongs to a teacher', async () => {
    const known = createHarness();
    const unknown = createHarness();
    unknown.repository.findActiveTeacherByEmail.mockResolvedValue(null);

    const knownAnswer = await known.service.requestOtp(TEACHER.email, null, GROUP_TOKEN);
    const unknownAnswer = await unknown.service.requestOtp(
      'stranger@example.com',
      null,
      GROUP_TOKEN,
    );

    // Identical wording is the whole point: a differing response would turn this
    // public form into a way to enumerate staff addresses.
    expect(knownAnswer).toEqual(unknownAnswer);
    expect(known.repository.findActiveTeacherByEmail).toHaveBeenCalledWith(TEACHER.email, 7);
    expect(known.emailService.sendOTP).toHaveBeenCalledTimes(1);
    expect(unknown.emailService.sendOTP).not.toHaveBeenCalled();
  });

  it('matches AraID only against an active teacher in the invitation school', async () => {
    const { service, repository, araIdService, sessionStore } = createHarness();

    await expect(service.verifyAraId(GROUP_TOKEN, 'araid-profile')).resolves.toEqual({
      bindingToken: 'binding-token',
      teacherName: `${TEACHER.first_name} ${TEACHER.last_name}`,
    });

    expect(araIdService.getVerifiedIdentityNumber).toHaveBeenCalledWith('araid-profile');
    expect(repository.findActiveTeacherByCitizenId).toHaveBeenCalledWith('1101700200018', 7);
    expect(sessionStore.createBindingSession).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 7, teacherId: TEACHER.teacher_id }),
    );
  });

  it('creates a real expiring AraID QR and can restore its details after refresh', async () => {
    const { service, araIdChallengeStore, repository } = createHarness();
    const stored = {
      token: 'c'.repeat(43),
      scope: 'teacher-line' as const,
      subjectId: '22222222-2222-4222-8222-222222222222',
      context: { schoolId: 7, schoolName: 'โรงเรียนทดสอบ' },
      referenceCode: 'A1B2C3',
      status: 'PENDING',
      entryExpiresAt: Date.now() + 90_000,
      expiresAt: Date.now() + 90_000,
    };
    araIdChallengeStore.create.mockResolvedValue(stored);
    araIdChallengeStore.read.mockResolvedValue(stored);
    repository.findActiveGroupInvitationForSchool.mockResolvedValue({
      ...GROUP_INVITATION,
      id: stored.subjectId,
      school_id: stored.context.schoolId,
      school_name: stored.context.schoolName,
    });

    const created = await service.createAraIdChallenge(GROUP_TOKEN);
    const restored = await service.getAraIdChallenge(stored.token);

    expect(created.verificationUrl).toBe(
      `https://sts.test/line-link/araid-authorize#challenge=${stored.token}`,
    );
    expect(created.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(created.referenceCode).toBe('A1B2C3');
    expect(created.expiresAt).toBe(new Date(stored.entryExpiresAt).toISOString());
    expect(restored).toEqual(created);
  }, 15_000);

  it('claims an active QR before login so completion can outlive the entry window', async () => {
    const { service, araIdChallengeStore, repository } = createHarness();
    const challenge = {
      scope: 'teacher-line' as const,
      subjectId: '22222222-2222-4222-8222-222222222222',
      context: { schoolId: 7, schoolName: 'โรงเรียนทดสอบ' },
      referenceCode: 'A1B2C3',
      status: 'PENDING',
      entryExpiresAt: Date.now() + 90_000,
      expiresAt: Date.now() + 90_000,
    };
    araIdChallengeStore.read.mockResolvedValue(challenge);
    araIdChallengeStore.claimOrRenew.mockResolvedValue({
      authorizationToken: 'd'.repeat(43),
      expiresAt: Date.now() + 600_000,
    });
    repository.findActiveGroupInvitationForSchool.mockResolvedValue({
      ...GROUP_INVITATION,
      id: challenge.subjectId,
      school_id: 7,
    });

    await expect(service.beginAraIdChallenge('c'.repeat(43))).resolves.toMatchObject({
      authorizationToken: 'd'.repeat(43),
    });
  });

  it('refuses to hand out a binding session on a wrong code', async () => {
    const { service, otpStore, sessionStore } = createHarness();
    otpStore.verify.mockResolvedValue('wrong');

    await expect(
      service.verifyOtp(TEACHER.email, '000000', null, GROUP_TOKEN),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessionStore.createBindingSession).not.toHaveBeenCalled();
  });

  it('does not issue another binding session when the teacher already has LINE', async () => {
    const { service, repository, sessionStore } = createHarness();
    repository.hasActiveAccountForTeacher.mockResolvedValue(true);

    await expect(
      service.verifyOtp(TEACHER.email, '123456', null, GROUP_TOKEN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sessionStore.createBindingSession).not.toHaveBeenCalled();
  });

  it('gives an unknown address the same rejection as a wrong code', async () => {
    const { service, repository, otpStore } = createHarness();
    repository.findActiveTeacherByEmail.mockResolvedValue(null);

    await expect(
      service.verifyOtp('stranger@example.com', '123456', null, GROUP_TOKEN),
    ).rejects.toThrow('อีเมลหรือรหัสยืนยันไม่ถูกต้อง');
    expect(otpStore.verify).not.toHaveBeenCalled();
  });

  it.each(['wrong', 'missing', 'expired', 'locked'])(
    'does not reveal OTP state for a known address (%s)',
    async (outcome) => {
      const { service, otpStore } = createHarness();
      otpStore.verify.mockResolvedValue(outcome);

      await expect(service.verifyOtp(TEACHER.email, '000000', null, GROUP_TOKEN)).rejects.toThrow(
        'อีเมลหรือรหัสยืนยันไม่ถูกต้อง',
      );
    },
  );

  it('keeps the generic request response when delivery fails', async () => {
    const known = createHarness();
    const unknown = createHarness();
    known.emailService.sendOTP.mockRejectedValue(new Error('mail unavailable'));
    unknown.repository.findActiveTeacherByEmail.mockResolvedValue(null);

    await expect(known.service.requestOtp(TEACHER.email, null, GROUP_TOKEN)).resolves.toEqual(
      await unknown.service.requestOtp('stranger@example.com', null, GROUP_TOKEN),
    );
  });

  it('binds the account once the OTP passed and the teacher added the account', async () => {
    const { service, repository, sessionStore } = createHarness();

    const result = await service.completeAuthorization('code', 'state-value', null);

    expect(result.outcome).toBe('SUCCESS');
    expect(repository.insertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherId: TEACHER.teacher_id,
        providerUserId: IDENTITY.providerUserId,
        friendState: 'FRIEND',
      }),
      expect.anything(),
    );
    expect(sessionStore.clearBindingSession).toHaveBeenCalledWith('binding-token');
  });

  it('does not record a binding for someone who has not added the account', async () => {
    const { service, repository, messaging, sessionStore } = createHarness();
    messaging.completeAuthorization.mockResolvedValue({
      identity: IDENTITY,
      friendState: 'NOT_FRIEND',
    });

    const result = await service.completeAuthorization('code', 'state-value', null);

    expect(result.outcome).toBe('NOT_FRIEND');
    expect(result.addContactUrl).toBe('https://line.me/R/ti/p/@sts');
    expect(repository.insertAccount).not.toHaveBeenCalled();
    // The OTP proof survives so the teacher can add the account and retry
    // without going through their inbox again.
    expect(sessionStore.clearBindingSession).not.toHaveBeenCalled();
  });

  it('refuses to move a chat account that already belongs to another teacher', async () => {
    const { service, repository } = createHarness();
    repository.findActiveAccountByProviderUser.mockResolvedValue({
      id: '9',
      teacher_id: '99',
      provider_user_id: IDENTITY.providerUserId,
    });

    const result = await service.completeAuthorization('code', 'state-value', null);

    expect(result.outcome).toBe('ALREADY_LINKED_TO_ANOTHER_TEACHER');
    expect(repository.insertAccount).not.toHaveBeenCalled();
    expect(repository.unlinkAccount).not.toHaveBeenCalled();
  });

  it('reclaims a chat account left behind by an inactive teacher', async () => {
    const { service, repository } = createHarness();
    repository.findActiveAccountByProviderUser.mockResolvedValue({
      id: '9',
      teacher_id: '99',
      provider_user_id: IDENTITY.providerUserId,
    });
    repository.hasActiveTeacherMembership.mockResolvedValue(false);

    const result = await service.completeAuthorization('code', 'state-value', null);

    expect(result.outcome).toBe('SUCCESS');
    expect(repository.unlinkAccount).toHaveBeenCalledWith(
      '9',
      'STALE_INACTIVE_TEACHER_BINDING',
      expect.anything(),
    );
    expect(repository.insertAccount).toHaveBeenCalledWith(
      expect.objectContaining({ teacherId: TEACHER.teacher_id }),
      expect.anything(),
    );
  });

  it('refuses to replace an existing teacher binding during callback', async () => {
    const { service, repository, sessionStore } = createHarness();
    repository.findActiveAccountForTeacher.mockResolvedValue({
      id: '4',
      teacher_id: TEACHER.teacher_id,
      provider_user_id: 'U0000000000000000000000000000999',
    });

    const result = await service.completeAuthorization('code', 'state-value', null);

    expect(result.outcome).toBe('TEACHER_ALREADY_LINKED');
    expect(repository.unlinkAccount).not.toHaveBeenCalled();
    expect(repository.insertAccount).not.toHaveBeenCalled();
    expect(sessionStore.clearBindingSession).toHaveBeenCalledWith('binding-token');
  });

  it('issues a scoped invitation while persisting only its hash', async () => {
    const { service, repository } = createHarness();

    const result = await service.issueInvitation(
      {
        teacherMembershipId: 12,
        teacherId: TEACHER.teacher_id,
        issuedBy: 1,
        baseUrl: 'https://sts.test',
      },
      {} as QueryRunner,
    );

    const url = new URL(result.url);
    const rawToken = new URLSearchParams(url.hash.slice(1)).get('token');
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    const [createInput] = repository.createInvitation.mock.calls[0] as unknown as [
      { teacherMembershipId: number; issuedBy: number; tokenHash: string },
      QueryRunner,
    ];
    expect(createInput.teacherMembershipId).toBe(12);
    expect(createInput.issuedBy).toBe(1);
    expect(createInput.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createInput.tokenHash).not.toBe(rawToken);
  });

  it('resolves an invitation with a masked email and no token fields', async () => {
    const { service } = createHarness();

    await expect(service.resolveInvitation('b'.repeat(64))).resolves.toEqual({
      teacherName: 'สมชาย ใจดี',
      maskedEmail: 's***@school.ac.th',
      expiresAt: INVITATION.expires_at,
    });
  });

  it('binds an invitation session only after its OTP and consumes it atomically', async () => {
    const { service, sessionStore, repository } = createHarness();
    sessionStore.readBindingSession.mockResolvedValue({
      teacherId: TEACHER.teacher_id,
      invitationId: INVITATION.id,
    });

    await expect(service.verifyInvitationOtp('b'.repeat(64), '123456', null)).resolves.toEqual({
      bindingToken: 'binding-token',
      teacherName: 'สมชาย ใจดี',
    });
    expect(sessionStore.createBindingSession).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: INVITATION.id, teacherId: TEACHER.teacher_id }),
    );

    await expect(service.completeAuthorization('code', 'state-value', null)).resolves.toMatchObject(
      {
        outcome: 'SUCCESS',
      },
    );
    expect(repository.findInvitationById).toHaveBeenCalledWith(
      INVITATION.id,
      expect.anything(),
      true,
    );
    expect(repository.consumeInvitation).toHaveBeenCalledWith(INVITATION.id, expect.anything());
  });

  it('rejects a consumed invitation before issuing OTP', async () => {
    const { service, repository, emailService } = createHarness();
    repository.findInvitationByTokenHash.mockResolvedValue({
      ...INVITATION,
      consumed_at: new Date().toISOString(),
    });

    await expect(service.requestInvitationOtp('b'.repeat(64), null)).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(emailService.sendOTP).not.toHaveBeenCalled();
  });

  it('treats a replayed callback as expired instead of binding again', async () => {
    const { service, sessionStore, repository } = createHarness();
    sessionStore.consumeOAuthState.mockResolvedValue(null);

    const result = await service.completeAuthorization('code', 'used-state', null);

    expect(result.outcome).toBe('EXPIRED');
    expect(repository.insertAccount).not.toHaveBeenCalled();
  });

  it('refuses every step while the integration is switched off', async () => {
    const { service, messaging } = createHarness();
    messaging.isEnabled.mockReturnValue(false);

    await expect(service.requestOtp(TEACHER.email, null, GROUP_TOKEN)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.startAuthorization('binding-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('sends the browser to a result page carrying only non-secret hints', () => {
    const { service } = createHarness();
    const url = new URL(service.buildResultUrl('NOT_FRIEND', 'https://line.me/R/ti/p/@sts'));

    expect(url.origin + url.pathname).toBe('https://sts.test/line-link/result');
    expect(url.searchParams.get('status')).toBe('not_friend');
    expect(url.searchParams.get('addUrl')).toBe('https://line.me/R/ti/p/@sts');
  });
});

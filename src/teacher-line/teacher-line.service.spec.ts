import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
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
      verificationMethod: 'ARAID',
    }),
    clearBindingSession: jest.fn().mockResolvedValue(undefined),
    createOAuthState: jest.fn().mockResolvedValue('state-value'),
    consumeOAuthState: jest.fn().mockResolvedValue({
      bindingToken: 'binding-token',
      teacherId: TEACHER.teacher_id,
      nonce: 'nonce-value',
    }),
  };
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
  const google = {
    authorizationUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth'),
    exchange: jest.fn().mockResolvedValue({
      subject: 'google-subject',
      email: TEACHER.email,
      persistIdentity: true,
    }),
    developmentIdentity: jest.fn().mockReturnValue({
      subject: 'sts-local-development',
      email: TEACHER.email,
      persistIdentity: false,
    }),
  };
  const googleStates = {
    create: jest.fn().mockResolvedValue({ state: 'google-state', nonce: 'google-nonce' }),
    consume: jest.fn().mockResolvedValue(null),
  };
  const service = new TeacherLineService(
    repository as unknown as TeacherLineRepository,
    sessionStore as never,
    tokenEncryption as never,
    auditLog as never,
    araIdService as never,
    araIdChallengeStore as never,
    messaging,
    { messagingChannelId: '2000000002' } as never,
    { frontendBaseUrl: 'https://sts.test' } as never,
    google as never,
    googleStates as never,
    { teacherLineCallbackUrl: 'https://api.sts.test/api/line/link/google/callback' } as never,
  );
  return {
    service,
    repository,
    sessionStore,
    auditLog,
    araIdService,
    araIdChallengeStore,
    messaging,
    tokenEncryption,
    google,
    googleStates,
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

  it('starts shared Google verification with school-scoped single-use state', async () => {
    const { service, google, googleStates } = createHarness();

    await expect(service.startGroupGoogleAuthorization(GROUP_TOKEN)).resolves.toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );

    expect(googleStates.create).toHaveBeenCalledWith('teacher-line-group', {
      subjectId: GROUP_INVITATION.id,
      tokenHash: GROUP_INVITATION.token_hash,
      schoolId: GROUP_INVITATION.school_id,
    });
    expect(google.authorizationUrl).toHaveBeenCalledWith(
      'google-state',
      'google-nonce',
      'https://api.sts.test/api/line/link/google/callback',
    );
  });

  it('accepts Google when it resolves to an active teacher in the link school', async () => {
    const { service, repository, sessionStore, googleStates } = createHarness();
    googleStates.consume.mockImplementation((flow: string) =>
      flow === 'teacher-line-group'
        ? {
            flow,
            subjectId: GROUP_INVITATION.id,
            tokenHash: GROUP_INVITATION.token_hash,
            schoolId: GROUP_INVITATION.school_id,
            nonce: 'google-nonce',
          }
        : null,
    );

    await expect(service.completeGoogleAuthorization('google-code', 'google-state')).resolves.toBe(
      'https://access.line.me/authorize',
    );
    expect(repository.findActiveTeacherByEmail).toHaveBeenCalledWith(
      TEACHER.email,
      GROUP_INVITATION.school_id,
    );
    expect(sessionStore.createBindingSession).toHaveBeenCalledWith({
      teacherId: TEACHER.teacher_id,
      schoolId: GROUP_INVITATION.school_id,
      verificationMethod: 'GOOGLE',
    });
  });

  it('uses an entered local email for shared LINE verification with school scope', async () => {
    const { service, google, repository, sessionStore } = createHarness();

    await expect(
      service.developmentGroupGoogleAuthorization(GROUP_TOKEN, ' Teacher@School.test '),
    ).resolves.toBe('https://access.line.me/authorize');

    expect(google.developmentIdentity).toHaveBeenCalledWith(' Teacher@School.test ');
    expect(repository.findActiveTeacherByEmail).toHaveBeenCalledWith(
      TEACHER.email,
      GROUP_INVITATION.school_id,
    );
    expect(sessionStore.createBindingSession).toHaveBeenCalledWith({
      teacherId: TEACHER.teacher_id,
      schoolId: GROUP_INVITATION.school_id,
      verificationMethod: 'GOOGLE',
    });
  });

  it('rejects an entered local email that is not an active school teacher', async () => {
    const { service, repository } = createHarness();
    repository.findActiveTeacherByEmail.mockResolvedValue(null);

    await expect(
      service.developmentGroupGoogleAuthorization(GROUP_TOKEN, 'outside@example.com'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a Google account that is not an active teacher in the link school', async () => {
    const { service, repository, googleStates } = createHarness();
    googleStates.consume.mockImplementation((flow: string) =>
      flow === 'teacher-line-group'
        ? {
            flow,
            subjectId: GROUP_INVITATION.id,
            tokenHash: GROUP_INVITATION.token_hash,
            schoolId: GROUP_INVITATION.school_id,
            nonce: 'google-nonce',
          }
        : null,
    );
    repository.findActiveTeacherByEmail.mockResolvedValue(null);

    await expect(
      service.completeGoogleAuthorization('google-code', 'google-state'),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

  it('binds the account once identity verification passed and the teacher added the account', async () => {
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
    // The short-lived identity proof survives so the teacher can add the
    // account and retry without authenticating again.
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

  it('treats a replayed callback as expired instead of binding again', async () => {
    const { service, sessionStore, repository } = createHarness();
    sessionStore.consumeOAuthState.mockResolvedValue(null);

    const result = await service.completeAuthorization('code', 'used-state', null);

    expect(result.outcome).toBe('EXPIRED');
    expect(repository.insertAccount).not.toHaveBeenCalled();
  });

  it('rejects a legacy binding session that has no Google or AraID proof', async () => {
    const { service, sessionStore, repository } = createHarness();
    sessionStore.readBindingSession.mockResolvedValue({ teacherId: TEACHER.teacher_id });

    await expect(service.completeAuthorization('code', 'state-value', null)).resolves.toEqual({
      outcome: 'EXPIRED',
      addContactUrl: null,
    });
    expect(sessionStore.clearBindingSession).toHaveBeenCalledWith('binding-token');
    expect(repository.insertAccount).not.toHaveBeenCalled();
  });

  it('refuses every step while the integration is switched off', async () => {
    const { service, messaging } = createHarness();
    messaging.isEnabled.mockReturnValue(false);

    await expect(service.startGroupGoogleAuthorization(GROUP_TOKEN)).rejects.toBeInstanceOf(
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

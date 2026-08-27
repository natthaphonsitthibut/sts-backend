import { ForbiddenException, GoneException, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { hashToken } from '../common/utils/helpers';
import { CLASSROOM_LINK_ARAID_SCOPE } from './classroom-attendance-links.constants';
import { ClassroomAttendanceLinksService } from './classroom-attendance-links.service';
import type { ClassroomLinkRow, ExternalTeacherRow } from './classroom-attendance-links.types';

const RAW_TOKEN = 'a'.repeat(64);
const LINK: ClassroomLinkRow = {
  id: '11111111-1111-4111-8111-111111111111',
  school_id: 10,
  school_name: 'โรงเรียนหนึ่ง',
  school_term_id: '20',
  academic_year: 2569,
  semester: 1,
  term_status: 'ACTIVE',
  classroom_id: '30',
  grade_level_id: 3,
  grade_label: 'ป.3',
  legacy_room_number: '1',
  room_name: 'ป.3/1',
  classroom_status: 'ACTIVE',
  token_hash: hashToken(RAW_TOKEN),
  token_encrypted: `enc:${RAW_TOKEN}`,
  link_status: 'ACTIVE',
  issued_at: '2026-08-23T00:00:00.000Z',
  rotated_at: null,
  last_used_at: null,
  homeroom_teacher_membership_id: '12',
  homeroom_teacher_name: 'ครูประจำชั้น',
  line_provider_user_id: 'U123',
  line_friend_state: 'FRIEND',
  line_delivery_teacher_membership_id: null,
  line_delivery_status: 'NOT_READY',
  line_delivery_failure_code: null,
  line_delivery_attempt_count: 0,
  line_delivery_request_id: null,
  line_delivery_last_attempted_at: null,
  line_delivered_at: null,
};

const TEACHER: ExternalTeacherRow = {
  teacher_id: '7',
  teacher_membership_id: '12',
  school_id: 10,
  teacher_display_name: 'ครู หนึ่ง',
  normalized_email: 'teacher@example.com',
  citizen_id: '1234567890123',
  teacher_status: 'ACTIVE',
  membership_status: 'ACTIVE',
  teacher_deleted_at: null,
  membership_deleted_at: null,
};

const ACTOR: AuthenticatedRequestUser = {
  id: 1,
  username: 'admin',
  roles: ['ADMIN'],
  permissions: ['manage-classroom-links'],
  data_scope: { school_ids: [10] },
};

describe('ClassroomAttendanceLinksService', () => {
  function setup() {
    const repository = {
      list: jest.fn(),
      withTransaction: jest.fn((callback: (runner: object) => unknown) =>
        Promise.resolve(callback({})),
      ),
      lockEligibleClassrooms: jest.fn(),
      upsertLink: jest.fn(),
      upsertLinks: jest.fn(),
      findById: jest.fn(),
      findUsableByTokenHash: jest.fn(),
      findUsableById: jest.fn(),
      isLinkInScope: jest.fn(),
      updateToken: jest.fn(),
      deactivate: jest.fn(),
      recordLineDeliveryNotReady: jest.fn(),
      claimLineDelivery: jest.fn(),
      finishLineDelivery: jest.fn(),
      findTeacherByEmail: jest.fn(),
      findTeacherByCitizenId: jest.fn(),
      findActiveMembership: jest.fn(),
      findActiveSchoolInScope: jest.fn(),
      bindExternalIdentity: jest.fn(),
      touchLinkUsed: jest.fn(),
    };
    const encryption = {
      encrypt: jest.fn((token: string) => `enc:${token}`),
      decrypt: jest.fn((token: string) => token.replace(/^enc:/, '')),
    };
    const sessions = { issue: jest.fn().mockResolvedValue('session-token'), read: jest.fn() };
    const googleStates = { create: jest.fn(), consume: jest.fn() };
    const google = {
      authorizationUrl: jest.fn(),
      exchange: jest.fn(),
      developmentIdentity: jest.fn().mockReturnValue({
        subject: 'sts-local-development',
        email: TEACHER.normalized_email,
        persistIdentity: false,
      }),
    };
    const araId = { getVerifiedIdentityClaim: jest.fn() };
    const araIdChallenges = {
      create: jest.fn(),
      resume: jest.fn(),
      claimOrRenew: jest.fn(),
      readAuthorization: jest.fn(),
      approveAuthorization: jest.fn(),
      read: jest.fn(),
      consumeApproved: jest.fn(),
    };
    const audit = { recordAtomic: jest.fn(), record: jest.fn() };
    const messaging = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendMessages: jest.fn().mockResolvedValue([{ providerUserId: 'U123', delivered: true }]),
    };
    const teacherLine = {
      issueGroupInvitation: jest.fn(),
      getActiveGroupInvitation: jest.fn(),
      updateGroupInvitation: jest.fn(),
      revokeGroupInvitation: jest.fn(),
    };
    return {
      service: new ClassroomAttendanceLinksService(
        repository as never,
        encryption as never,
        sessions as never,
        googleStates as never,
        google as never,
        araId as never,
        araIdChallenges as never,
        audit as never,
        messaging as never,
        teacherLine as never,
        {
          classroomCallbackUrl: 'https://api.example/api/check-in/auth/google/callback',
        } as never,
      ),
      repository,
      sessions,
      googleStates,
      google,
      araId,
      araIdChallenges,
      messaging,
      audit,
      teacherLine,
    };
  }

  it('returns an app-served homeroom photo URL without exposing the storage key', async () => {
    const { service, repository } = setup();
    repository.list.mockResolvedValue({
      rows: [
        {
          ...LINK,
          school_status: 'ACTIVE',
          homeroom_teacher_id: '7',
          homeroom_teacher_has_photo: true,
          homeroom_teachers: [
            { teacherId: '7', teacherName: 'ครูประจำชั้น', hasPhoto: true, isPrimary: true },
            { teacherId: '8', teacherName: 'ครูร่วม', hasPhoto: false, isPrimary: false },
          ],
          latest_session_id: null,
          latest_session_date: null,
          latest_session_status: null,
          latest_session_submitted_at: null,
        },
      ],
      total: 1,
    });

    const result = await service.list(
      { schoolId: 10, schoolTermId: 20, page: 1, limit: 20 },
      ACTOR,
    );

    expect(result.data[0]).toMatchObject({
      homeroomTeacherName: 'ครูประจำชั้น',
      homeroomTeacherId: '7',
      homeroomTeacherPhotoUrl: '/api/teacher-profiles/7/photo',
      homeroomTeachers: [
        {
          teacherId: '7',
          teacherName: 'ครูประจำชั้น',
          photoUrl: '/api/teacher-profiles/7/photo',
          isPrimary: true,
        },
        { teacherId: '8', teacherName: 'ครูร่วม', photoUrl: null, isPrimary: false },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('photo_storage_key');
  });

  it('issues the school LINE invitation only after server-side school scope validation', async () => {
    const { service, repository, teacherLine, audit } = setup();
    repository.findActiveSchoolInScope.mockResolvedValue({
      id: 10,
      name: 'โรงเรียนหนึ่ง',
    });
    teacherLine.issueGroupInvitation.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      schoolId: 10,
      schoolName: 'โรงเรียนหนึ่ง',
      url: 'https://sts.example/line-link#token=secret',
      startsAt: '2026-08-24T12:00:00.000Z',
      expiresAt: '2026-08-31T12:00:00.000Z',
    });

    await expect(
      service.issueLineGroupInvitation(
        {
          schoolId: 10,
          startsAt: '2026-08-24T12:00:00.000Z',
          expiresAt: '2026-08-31T12:00:00.000Z',
        },
        ACTOR,
        'https://sts.example',
      ),
    ).resolves.toMatchObject({ success: true, data: { schoolId: 10 } });
    expect(repository.findActiveSchoolInScope).toHaveBeenCalledWith(10, {
      school_ids: [10],
    });
    expect(teacherLine.issueGroupInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 10, schoolName: 'โรงเรียนหนึ่ง' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEACHER_LINE_INVITATION_ISSUE',
        targetType: 'teacher_line_group_invitation',
      }),
    );
  });

  it('rejects school-wide LINE invitation management from grade or room scope', async () => {
    const { service, repository, teacherLine } = setup();
    const scopedActor: AuthenticatedRequestUser = {
      ...ACTOR,
      data_scope: { school_ids: [10], grade_levels: [3] },
    };

    await expect(
      service.getLineGroupInvitation(10, scopedActor, 'https://sts.example'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findActiveSchoolInScope).not.toHaveBeenCalled();
    expect(teacherLine.getActiveGroupInvitation).not.toHaveBeenCalled();
  });

  it('sends a classroom link to the reachable current homeroom membership', async () => {
    const { service, repository, messaging, audit } = setup();
    const sending = {
      ...LINK,
      line_delivery_teacher_membership_id: '12',
      line_delivery_status: 'SENDING' as const,
      line_delivery_attempt_count: 1,
      line_delivery_request_id: '3c195ce0-1f57-4e5c-a2cf-930a6315f28a',
      line_delivery_last_attempted_at: '2026-08-23T01:00:00.000Z',
    };
    const sent = {
      ...sending,
      line_delivery_status: 'SENT' as const,
      line_delivered_at: '2026-08-23T01:00:01.000Z',
    };
    repository.isLinkInScope.mockResolvedValue(true);
    repository.findById.mockResolvedValue(LINK);
    repository.claimLineDelivery.mockResolvedValue(sending);
    repository.finishLineDelivery.mockResolvedValue(sent);

    await expect(
      service.resendLine(
        LINK.id,
        { deliveryRequestId: '3c195ce0-1f57-4e5c-a2cf-930a6315f28a' },
        ACTOR,
        'https://sts.example',
      ),
    ).resolves.toMatchObject({
      data: { lineDelivery: { status: 'SENT', recipientTeacherMembershipId: '12' } },
    });

    expect(messaging.sendMessages).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          providerUserId: 'U123',
        }),
      ],
      'classroom-links-3c195ce0-1f57-4e5c-a2cf-930a6315f28a',
    );
    const sendCalls = messaging.sendMessages.mock.calls as unknown as Array<
      [Array<{ text: string }>]
    >;
    const sentMessages = sendCalls[0][0];
    expect(sentMessages[0].text).toContain('#token=');
    expect(repository.finishLineDelivery).toHaveBeenCalledWith(
      LINK.id,
      '3c195ce0-1f57-4e5c-a2cf-930a6315f28a',
      true,
      null,
      1,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLASSROOM_ATTENDANCE_LINK_LINE_SEND' }),
    );
  });

  it('keeps the link usable and records not-ready when LINE is disabled', async () => {
    const { service, repository, messaging } = setup();
    messaging.isEnabled.mockReturnValue(false);
    repository.isLinkInScope.mockResolvedValue(true);
    repository.findById.mockResolvedValue(LINK);
    repository.recordLineDeliveryNotReady.mockResolvedValue({
      ...LINK,
      line_delivery_teacher_membership_id: '12',
      line_delivery_failure_code: 'MESSAGING_DISABLED',
    });

    await expect(
      service.resendLine(
        LINK.id,
        { deliveryRequestId: '84dd51d3-bbee-47b8-9968-12815ea97c83' },
        ACTOR,
        'https://sts.example',
      ),
    ).resolves.toMatchObject({
      data: { lineDelivery: { status: 'NOT_READY', failureCode: 'MESSAGING_DISABLED' } },
    });

    expect(repository.recordLineDeliveryNotReady).toHaveBeenCalledWith(
      LINK.id,
      '12',
      'MESSAGING_DISABLED',
      1,
    );
    expect(messaging.sendMessages).not.toHaveBeenCalled();
  });

  it('does not duplicate a completed delivery with the same request id', async () => {
    const { service, repository, messaging } = setup();
    const sent = {
      ...LINK,
      line_delivery_teacher_membership_id: '12',
      line_delivery_status: 'SENT' as const,
      line_delivery_attempt_count: 1,
      line_delivery_request_id: '2b4335e5-466b-4bc3-9cc0-e65bd6002af6',
      line_delivery_last_attempted_at: '2026-08-23T01:00:00.000Z',
      line_delivered_at: '2026-08-23T01:00:01.000Z',
    };
    repository.isLinkInScope.mockResolvedValue(true);
    repository.findById.mockResolvedValueOnce(LINK).mockResolvedValue(sent);
    repository.claimLineDelivery.mockResolvedValue(null);

    await expect(
      service.resendLine(
        LINK.id,
        { deliveryRequestId: '2b4335e5-466b-4bc3-9cc0-e65bd6002af6' },
        ACTOR,
        'https://sts.example',
      ),
    ).resolves.toMatchObject({ data: { lineDelivery: { status: 'SENT', attemptCount: 1 } } });

    expect(messaging.sendMessages).not.toHaveBeenCalled();
    expect(repository.finishLineDelivery).not.toHaveBeenCalled();
  });

  it('preserves the link and records a failed delivery when the provider is unavailable', async () => {
    const { service, repository, messaging } = setup();
    const requestId = 'b6d2a18f-a657-4b4d-a222-b5033b7f0b65';
    const sending = {
      ...LINK,
      line_delivery_teacher_membership_id: '12',
      line_delivery_status: 'SENDING' as const,
      line_delivery_attempt_count: 1,
      line_delivery_request_id: requestId,
      line_delivery_last_attempted_at: '2026-08-23T01:00:00.000Z',
    };
    repository.isLinkInScope.mockResolvedValue(true);
    repository.findById.mockResolvedValue(LINK);
    repository.claimLineDelivery.mockResolvedValue(sending);
    repository.finishLineDelivery.mockResolvedValue({
      ...sending,
      line_delivery_status: 'FAILED',
      line_delivery_failure_code: 'PROVIDER_UNAVAILABLE',
    });
    messaging.sendMessages.mockResolvedValue([{ providerUserId: 'U123', delivered: false }]);

    await expect(
      service.resendLine(LINK.id, { deliveryRequestId: requestId }, ACTOR, 'https://sts.example'),
    ).resolves.toMatchObject({
      data: { id: LINK.id, lineDelivery: { status: 'FAILED', canRetry: true } },
    });
    expect(repository.finishLineDelivery).toHaveBeenCalledWith(
      LINK.id,
      requestId,
      false,
      'PROVIDER_UNAVAILABLE',
      1,
    );
  });

  it('reports an unverified current homeroom account without calling the provider', async () => {
    const { service, repository, messaging } = setup();
    const unverified = { ...LINK, line_provider_user_id: null, line_friend_state: null };
    repository.isLinkInScope.mockResolvedValue(true);
    repository.findById.mockResolvedValue(unverified);
    repository.recordLineDeliveryNotReady.mockResolvedValue({
      ...unverified,
      line_delivery_teacher_membership_id: '12',
      line_delivery_failure_code: 'ACCOUNT_NOT_VERIFIED',
    });

    await expect(
      service.resendLine(
        LINK.id,
        { deliveryRequestId: '7b116194-4c62-4565-8dab-09ccdd13f098' },
        ACTOR,
        'https://sts.example',
      ),
    ).resolves.toMatchObject({
      data: { lineDelivery: { failureCode: 'ACCOUNT_NOT_VERIFIED' } },
    });
    expect(messaging.sendMessages).not.toHaveBeenCalled();
  });

  it('authenticates a verified Google email against any active same-school teacher membership', async () => {
    const { service, repository, sessions, googleStates, google } = setup();
    googleStates.consume.mockResolvedValue({
      flow: 'classroom-link',
      subjectId: LINK.id,
      tokenHash: LINK.token_hash,
      schoolId: LINK.school_id,
      nonce: 'nonce',
    });
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    google.exchange.mockResolvedValue({
      subject: 'google-subject',
      email: TEACHER.normalized_email,
      persistIdentity: true,
    });
    repository.findTeacherByEmail.mockResolvedValue(TEACHER);

    await expect(service.googleCallback('code', 'state')).resolves.toBe('session-token');

    expect(repository.findTeacherByEmail).toHaveBeenCalledWith('teacher@example.com', 10);
    expect(repository.bindExternalIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherId: '7',
        provider: 'GOOGLE',
        providerSubject: 'google-subject',
      }),
      expect.anything(),
    );
    expect(sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        linkId: LINK.id,
        tokenHash: LINK.token_hash,
        teacherMembershipId: '12',
      }),
    );
  });

  it('does not persist a synthetic identity for local Google development mode', async () => {
    const { service, repository, googleStates, google } = setup();
    googleStates.consume.mockResolvedValue({
      flow: 'classroom-link',
      subjectId: LINK.id,
      tokenHash: LINK.token_hash,
      schoolId: LINK.school_id,
      nonce: 'nonce',
    });
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    google.exchange.mockResolvedValue({
      subject: 'sts-local-development',
      email: TEACHER.normalized_email,
      persistIdentity: false,
    });
    repository.findTeacherByEmail.mockResolvedValue(TEACHER);

    await expect(service.googleCallback('code', 'state')).resolves.toBe('session-token');

    expect(repository.bindExternalIdentity).not.toHaveBeenCalled();
  });

  it('uses the entered local email only after matching an active teacher in the link school', async () => {
    const { service, repository, google, sessions } = setup();
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    repository.findTeacherByEmail.mockResolvedValue(TEACHER);

    await expect(service.googleDevelopment('a'.repeat(64), ' Teacher@Example.com ')).resolves.toBe(
      'session-token',
    );

    expect(google.developmentIdentity).toHaveBeenCalledWith(' Teacher@Example.com ');
    expect(repository.findTeacherByEmail).toHaveBeenCalledWith(
      TEACHER.normalized_email,
      LINK.school_id,
    );
    expect(repository.bindExternalIdentity).not.toHaveBeenCalled();
    expect(sessions.issue).toHaveBeenCalled();
  });

  it('rejects an entered local email outside the link school', async () => {
    const { service, repository } = setup();
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    repository.findTeacherByEmail.mockResolvedValue(null);

    await expect(
      service.googleDevelopment('a'.repeat(64), 'outside@example.com'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a verified Google identity without an active membership in the link school', async () => {
    const { service, repository, googleStates, google } = setup();
    googleStates.consume.mockResolvedValue({
      flow: 'classroom-link',
      subjectId: LINK.id,
      tokenHash: LINK.token_hash,
      schoolId: LINK.school_id,
      nonce: 'nonce',
    });
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    google.exchange.mockResolvedValue({ subject: 'google-subject', email: 'outside@example.com' });
    repository.findTeacherByEmail.mockResolvedValue(null);

    await expect(service.googleCallback('code', 'state')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denies an inactive teacher even when email and school membership match', async () => {
    const { service, repository, googleStates, google } = setup();
    googleStates.consume.mockResolvedValue({
      flow: 'classroom-link',
      subjectId: LINK.id,
      tokenHash: LINK.token_hash,
      schoolId: LINK.school_id,
      nonce: 'nonce',
    });
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    google.exchange.mockResolvedValue({
      subject: 'google-subject',
      email: TEACHER.normalized_email,
    });
    repository.findTeacherByEmail.mockResolvedValue({ ...TEACHER, teacher_status: 'INACTIVE' });

    await expect(service.googleCallback('code', 'state')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a revoked or rotated raw token before revealing context', async () => {
    const { service, repository } = setup();
    repository.findUsableByTokenHash.mockResolvedValue(null);

    await expect(service.context(RAW_TOKEN)).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects a session after token rotation even when the link id is unchanged', async () => {
    const { service, repository, sessions } = setup();
    sessions.read.mockResolvedValue({
      linkId: LINK.id,
      tokenHash: 'old-hash',
      teacherId: '7',
      teacherMembershipId: '12',
      schoolId: 10,
      provider: 'GOOGLE',
      issuedAt: Date.now(),
    });
    repository.findUsableById.mockResolvedValue(LINK);

    await expect(service.context(undefined, 'session-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.findActiveMembership).not.toHaveBeenCalled();
  });

  // The phone opens this URL after scanning; it reads the challenge and the
  // scope out of the hash, so a renamed key silently breaks every scan.
  it('points the scanned QR at a verification url the phone can read', async () => {
    const { service, repository, araIdChallenges } = setup();
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    araIdChallenges.create.mockResolvedValue({
      token: 'challenge-token',
      referenceCode: 'REF123',
      entryExpiresAt: Date.now() + 60_000,
    });

    const result = await service.createAraIdChallenge(RAW_TOKEN, 'https://app.example');

    const hash = new URL(result.data.verificationUrl).hash.slice(1);
    const params = new URLSearchParams(hash);
    expect(new URL(result.data.verificationUrl).pathname).toBe('/araid/authorize');
    expect(params.get('challenge')).toBe('challenge-token');
    expect(params.get('scope')).toBe(CLASSROOM_LINK_ARAID_SCOPE);
  });

  it('accepts AraID only for the active teacher whose citizen id is in the link school', async () => {
    const { service, repository, araId, araIdChallenges } = setup();
    araIdChallenges.readAuthorization.mockResolvedValue({
      challenge: { subjectId: LINK.id, context: { tokenHash: LINK.token_hash } },
      minimumAuthenticatedAt: 100,
    });
    repository.findUsableByTokenHash.mockResolvedValue(LINK);
    araId.getVerifiedIdentityClaim.mockResolvedValue({
      providerSubject: 'araid-record-id',
      identityNumber: TEACHER.citizen_id,
    });
    repository.findTeacherByCitizenId.mockResolvedValue(TEACHER);
    araIdChallenges.approveAuthorization.mockResolvedValue(true);

    await expect(service.approveAraIdChallenge('authorization', 'profile', 101)).resolves.toEqual({
      success: true,
      data: { approved: true },
    });
    expect(repository.findTeacherByCitizenId).toHaveBeenCalledWith(TEACHER.citizen_id, 10);
    expect(repository.bindExternalIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'THAID',
        teacherId: '7',
        providerSubject: 'araid-record-id',
      }),
      expect.anything(),
    );
  });

  it('creates selected links only from server-scoped active classroom rows', async () => {
    const { service, repository } = setup();
    repository.lockEligibleClassrooms.mockResolvedValue([{ classroom_id: '30' }]);
    repository.upsertLinks.mockImplementation(
      (inputs: Array<{ tokenHash: string; tokenEncrypted: string }>) =>
        Promise.resolve([
          { ...LINK, token_hash: inputs[0].tokenHash, token_encrypted: inputs[0].tokenEncrypted },
        ]),
    );

    const result = await service.bulkCreate(
      { schoolId: 10, schoolTermId: 20, classroomIds: [30] },
      ACTOR,
      'https://sts.example',
    );

    expect(repository.lockEligibleClassrooms).toHaveBeenCalledWith(
      expect.objectContaining({ classroomIds: [30], scope: { school_ids: [10] } }),
      expect.anything(),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].accessUrl).toMatch(/^https:\/\/sts\.example\/classroom#token=/);
  });

  it('commits newly created links before sending them over LINE', async () => {
    const { service, repository, messaging } = setup();
    const events: string[] = [];
    repository.withTransaction.mockImplementation(async (callback: (runner: object) => unknown) => {
      const result = await callback({});
      events.push('commit');
      return result;
    });
    repository.lockEligibleClassrooms.mockResolvedValue([{ classroom_id: '30' }]);
    let createdTokenHash = LINK.token_hash;
    let createdTokenEncrypted = LINK.token_encrypted;
    repository.upsertLinks.mockImplementation(
      (inputs: Array<{ tokenHash: string; tokenEncrypted: string }>) => {
        createdTokenHash = inputs[0].tokenHash;
        createdTokenEncrypted = inputs[0].tokenEncrypted;
        return Promise.resolve([
          { ...LINK, token_hash: createdTokenHash, token_encrypted: createdTokenEncrypted },
        ]);
      },
    );
    repository.claimLineDelivery.mockResolvedValue({
      ...LINK,
      line_delivery_status: 'SENDING',
      line_delivery_teacher_membership_id: '12',
    });
    repository.finishLineDelivery.mockResolvedValue({
      ...LINK,
      line_delivery_status: 'SENT',
      line_delivery_teacher_membership_id: '12',
    });
    messaging.sendMessages.mockImplementation(() => {
      events.push('send');
      return Promise.resolve([{ providerUserId: 'U123', delivered: true }]);
    });

    await service.bulkCreate(
      { schoolId: 10, schoolTermId: 20, classroomIds: [30] },
      ACTOR,
      'https://sts.example',
    );

    expect(events).toEqual(['commit', 'send']);
  });
});

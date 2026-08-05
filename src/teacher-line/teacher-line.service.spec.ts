import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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

function createHarness() {
  const repository = {
    withTransaction: jest.fn(async (operation: (runner: QueryRunner) => Promise<unknown>) =>
      operation({} as QueryRunner),
    ),
    findActiveTeacherByEmail: jest.fn().mockResolvedValue(TEACHER),
    findActiveAccountForTeacher: jest.fn().mockResolvedValue(null),
    findActiveAccountByProviderUser: jest.fn().mockResolvedValue(null),
    unlinkAccount: jest.fn().mockResolvedValue(undefined),
    insertAccount: jest.fn().mockResolvedValue('1'),
    updateFriendState: jest.fn().mockResolvedValue(undefined),
  };
  const sessionStore = {
    createBindingSession: jest.fn().mockResolvedValue('binding-token'),
    readBindingSession: jest.fn().mockResolvedValue({
      teacherId: TEACHER.teacher_id,
      email: TEACHER.email,
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
  const auditLog = {
    record: jest.fn().mockResolvedValue(undefined),
    recordAtomic: jest.fn().mockResolvedValue(undefined),
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
    otpStore as never,
    emailService as never,
    auditLog as never,
    messaging,
    { messagingChannelId: '2000000002' } as never,
    { frontendBaseUrl: 'https://sts.test' } as never,
    { otpTtlSeconds: 600 } as never,
  );
  return { service, repository, sessionStore, otpStore, emailService, auditLog, messaging };
}

describe('TeacherLineService', () => {
  it('answers the same way whether or not the address belongs to a teacher', async () => {
    const known = createHarness();
    const unknown = createHarness();
    unknown.repository.findActiveTeacherByEmail.mockResolvedValue(null);

    const knownAnswer = await known.service.requestOtp(TEACHER.email, null);
    const unknownAnswer = await unknown.service.requestOtp('stranger@example.com', null);

    // Identical wording is the whole point: a differing response would turn this
    // public form into a way to enumerate staff addresses.
    expect(knownAnswer).toEqual(unknownAnswer);
    expect(known.emailService.sendOTP).toHaveBeenCalledTimes(1);
    expect(unknown.emailService.sendOTP).not.toHaveBeenCalled();
  });

  it('refuses to hand out a binding session on a wrong code', async () => {
    const { service, otpStore, sessionStore } = createHarness();
    otpStore.verify.mockResolvedValue('wrong');

    await expect(service.verifyOtp(TEACHER.email, '000000', null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sessionStore.createBindingSession).not.toHaveBeenCalled();
  });

  it('gives an unknown address the same rejection as a wrong code', async () => {
    const { service, repository, otpStore } = createHarness();
    repository.findActiveTeacherByEmail.mockResolvedValue(null);

    await expect(service.verifyOtp('stranger@example.com', '123456', null)).rejects.toThrow(
      'อีเมลหรือรหัสยืนยันไม่ถูกต้อง',
    );
    expect(otpStore.verify).not.toHaveBeenCalled();
  });

  it.each(['wrong', 'missing', 'expired', 'locked'])(
    'does not reveal OTP state for a known address (%s)',
    async (outcome) => {
      const { service, otpStore } = createHarness();
      otpStore.verify.mockResolvedValue(outcome);

      await expect(service.verifyOtp(TEACHER.email, '000000', null)).rejects.toThrow(
        'อีเมลหรือรหัสยืนยันไม่ถูกต้อง',
      );
    },
  );

  it('keeps the generic request response when delivery fails', async () => {
    const known = createHarness();
    const unknown = createHarness();
    known.emailService.sendOTP.mockRejectedValue(new Error('mail unavailable'));
    unknown.repository.findActiveTeacherByEmail.mockResolvedValue(null);

    await expect(known.service.requestOtp(TEACHER.email, null)).resolves.toEqual(
      await unknown.service.requestOtp('stranger@example.com', null),
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

  it('keeps the previous binding as history when a teacher links a new account', async () => {
    const { service, repository } = createHarness();
    repository.findActiveAccountForTeacher.mockResolvedValue({
      id: '4',
      teacher_id: TEACHER.teacher_id,
      provider_user_id: 'U0000000000000000000000000000999',
    });

    const result = await service.completeAuthorization('code', 'state-value', null);

    expect(result.outcome).toBe('SUCCESS');
    expect(repository.unlinkAccount).toHaveBeenCalledWith(
      '4',
      'REPLACED_BY_NEW_VERIFICATION',
      expect.anything(),
    );
    expect(repository.insertAccount).toHaveBeenCalled();
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

    await expect(service.requestOtp(TEACHER.email, null)).rejects.toBeInstanceOf(
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

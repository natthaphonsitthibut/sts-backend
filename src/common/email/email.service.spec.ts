import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

describe('EmailService', () => {
  it('logs the simulated OTP without recipient data outside production', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new EmailService({
      enabled: false,
      logSimulatedOtp: true,
      host: 'smtp.example.invalid',
      port: 587,
      user: '',
      pass: '',
      from: 'noreply@example.invalid',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthRefreshToken: '',
    });

    await expect(service.sendOTP('teacher@example.invalid', '123456')).resolves.toEqual({
      success: true,
      provider: 'SIMULATOR',
    });

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('teacher@example.invalid');
    expect(logged).toContain('[SIMULATED_EMAIL_OTP] code=123456');
    warn.mockRestore();
  });

  it('hides the simulated OTP in production', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new EmailService({
      enabled: false,
      logSimulatedOtp: false,
      host: 'smtp.example.invalid',
      port: 587,
      user: '',
      pass: '',
      from: 'noreply@example.invalid',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthRefreshToken: '',
    });

    await service.sendOTP('teacher@example.invalid', '123456');

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('teacher@example.invalid');
    expect(logged).not.toContain('123456');
    warn.mockRestore();
  });

  it('fails closed when delivery is enabled without a sender account', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new EmailService({
      enabled: true,
      logSimulatedOtp: false,
      host: 'smtp.example.invalid',
      port: 587,
      user: '',
      pass: '',
      from: 'noreply@example.invalid',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthRefreshToken: '',
    });

    await expect(service.sendOTP('teacher@example.invalid', '123456')).rejects.toThrow(
      'EMAIL_USER is not configured',
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

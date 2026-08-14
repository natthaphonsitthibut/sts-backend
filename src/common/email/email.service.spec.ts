import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

describe('EmailService', () => {
  it('never logs a simulated OTP or recipient when delivery is disabled', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new EmailService({
      enabled: false,
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
    expect(logged).not.toContain('123456');
    warn.mockRestore();
  });
});

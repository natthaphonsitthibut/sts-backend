import { getEmailConfigFromEnv } from './email.config';

describe('emailConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmailEnabled = process.env.EMAIL_ENABLED;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalEmailEnabled === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = originalEmailEnabled;
    }
  });

  it('logs simulated OTPs only when delivery is disabled in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_ENABLED = 'false';

    expect(getEmailConfigFromEnv().logSimulatedOtp).toBe(true);
  });

  it.each(['staging', 'production'])('hides simulated OTPs in %s', (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.EMAIL_ENABLED = 'false';

    expect(getEmailConfigFromEnv().logSimulatedOtp).toBe(false);
  });

  it('does not log simulated OTPs when email delivery is enabled', () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_ENABLED = 'true';

    expect(getEmailConfigFromEnv().logSimulatedOtp).toBe(false);
  });
});

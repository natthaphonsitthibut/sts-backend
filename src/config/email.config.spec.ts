import { getEmailConfigFromEnv } from './email.config';

describe('emailConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('logs simulated OTPs outside production', () => {
    process.env.NODE_ENV = 'development';

    expect(getEmailConfigFromEnv().logSimulatedOtp).toBe(true);
  });

  it('hides simulated OTPs in production', () => {
    process.env.NODE_ENV = 'production';

    expect(getEmailConfigFromEnv().logSimulatedOtp).toBe(false);
  });
});

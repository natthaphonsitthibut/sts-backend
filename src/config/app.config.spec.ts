import { getAppConfigFromEnv } from './app.config';

describe('getAppConfigFromEnv swagger flag', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('serves Swagger outside production by default', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SWAGGER_ENABLED;
    expect(getAppConfigFromEnv().swaggerEnabled).toBe(true);
  });

  it('keeps Swagger off in production unless SWAGGER_ENABLED=true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SWAGGER_ENABLED;
    expect(getAppConfigFromEnv().swaggerEnabled).toBe(false);
    process.env.SWAGGER_ENABLED = 'true';
    expect(getAppConfigFromEnv().swaggerEnabled).toBe(true);
  });

  it('lets SWAGGER_ENABLED=false switch it off in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.SWAGGER_ENABLED = 'false';
    expect(getAppConfigFromEnv().swaggerEnabled).toBe(false);
  });
});

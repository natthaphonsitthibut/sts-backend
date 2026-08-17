import { getAraIdConfigFromEnv } from './araid.config';

describe('araIdConfig', () => {
  const originalMode = process.env.ARAID_MODE;

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.ARAID_MODE;
    } else {
      process.env.ARAID_MODE = originalMode;
    }
  });

  it('defaults to the local AraID mock provider', () => {
    delete process.env.ARAID_MODE;
    expect(getAraIdConfigFromEnv()).toEqual({ mode: 'mock' });
  });

  it('accepts the documented mock mode', () => {
    process.env.ARAID_MODE = 'mock';
    expect(getAraIdConfigFromEnv()).toEqual({ mode: 'mock' });
  });

  it('fails closed for a provider mode that is not implemented', () => {
    process.env.ARAID_MODE = 'thaid';
    expect(() => getAraIdConfigFromEnv()).toThrow('ARAID_MODE must be "mock"');
  });
});

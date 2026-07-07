import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EndWorkSessionDto, PositionPingDto, StartWorkSessionDto } from './visit-work-sessions.dto';

describe('StartWorkSessionDto', () => {
  it('requires consent to be a boolean', async () => {
    const errors = await validate(plainToInstance(StartWorkSessionDto, {}));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts consent: true', async () => {
    const errors = await validate(plainToInstance(StartWorkSessionDto, { consent: true }));
    expect(errors).toHaveLength(0);
  });
});

describe('EndWorkSessionDto', () => {
  it('allows an omitted reason', async () => {
    const errors = await validate(plainToInstance(EndWorkSessionDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('rejects TIMEOUT — that reason is cron-only, never guest-supplied', async () => {
    const errors = await validate(plainToInstance(EndWorkSessionDto, { reason: 'TIMEOUT' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts MANUAL and SUBMITTED', async () => {
    for (const reason of ['MANUAL', 'SUBMITTED']) {
      const errors = await validate(plainToInstance(EndWorkSessionDto, { reason }));
      expect(errors).toHaveLength(0);
    }
  });
});

describe('PositionPingDto', () => {
  it('rejects out-of-range latitude/longitude', async () => {
    const errors = await validate(plainToInstance(PositionPingDto, { lat: 999, lng: 98 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid coordinates', async () => {
    const errors = await validate(plainToInstance(PositionPingDto, { lat: 18.79, lng: 98.98 }));
    expect(errors).toHaveLength(0);
  });
});

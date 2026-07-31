import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DelegateTaskDto } from './dto/task.dto';

describe('DelegateTaskDto', () => {
  it('requires a valid email and rejects invalid expiry values', async () => {
    const dto = plainToInstance(DelegateTaskDto, {
      new_assignee_name: 'ผู้รับใหม่',
      new_assignee_phone: '0812345678',
      new_assignee_email: 'invalid-email',
      expires_in_hours: -1,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['new_assignee_email', 'expires_in_hours']),
    );
  });

  it('rejects a missing OTP email', async () => {
    const dto = plainToInstance(DelegateTaskDto, {
      new_assignee_name: 'ผู้รับใหม่',
      new_assignee_phone: '0812345678',
      expires_at: '2026-08-01T12:00:00.000Z',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('new_assignee_email');
  });

  it('transforms and accepts a valid expiry value', async () => {
    const dto = plainToInstance(DelegateTaskDto, {
      new_assignee_name: 'ผู้รับใหม่',
      new_assignee_phone: '0812345678',
      new_assignee_email: 'delegate@example.invalid',
      delegation_note: 'ติดตามนักเรียนตามแผน',
      expires_in_hours: '24',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.expires_in_hours).toBe(24);
  });

  it('accepts an explicit expiry timestamp', async () => {
    const dto = plainToInstance(DelegateTaskDto, {
      new_assignee_first_name: 'ผู้รับ',
      new_assignee_last_name: 'ใหม่',
      new_assignee_phone: '0812345678',
      new_assignee_email: 'delegate@example.invalid',
      delegation_note: 'ติดตามนักเรียนตามแผน',
      expires_at: '2026-08-01T12:00:00.000Z',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

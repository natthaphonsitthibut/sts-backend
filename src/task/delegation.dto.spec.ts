import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DelegateTaskDto } from './dto/task.dto';

describe('DelegateTaskDto', () => {
  it('rejects invalid email and expiry values', async () => {
    const dto = plainToInstance(DelegateTaskDto, {
      new_assignee_name: 'ผู้รับใหม่',
      new_assignee_email: 'invalid-email',
      expires_in_hours: -1,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['new_assignee_email', 'expires_in_hours']),
    );
  });

  it('transforms and accepts a valid expiry value', async () => {
    const dto = plainToInstance(DelegateTaskDto, {
      new_assignee_name: 'ผู้รับใหม่',
      new_assignee_email: 'delegate@example.invalid',
      expires_in_hours: '24',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.expires_in_hours).toBe(24);
  });
});

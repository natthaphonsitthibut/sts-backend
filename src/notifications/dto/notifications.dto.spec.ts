import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotificationsQueryDto } from './notifications.dto';

describe('ListNotificationsQueryDto', () => {
  it.each(['all', 'unread', 'read'])('accepts status %s', async (status) => {
    const result = await validate(plainToInstance(ListNotificationsQueryDto, { status }));

    expect(result).toHaveLength(0);
  });

  it('rejects an unknown status', async () => {
    const result = await validate(
      plainToInstance(ListNotificationsQueryDto, { status: 'pending' }),
    );

    expect(result).toHaveLength(1);
    expect(result[0].property).toBe('status');
  });
});

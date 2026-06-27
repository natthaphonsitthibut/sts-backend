import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { appConfig } from '../config/app.config';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';

describe('DelegationController', () => {
  it('passes the magic-session header to the delegation service', async () => {
    const delegationService = {
      delegateTask: jest.fn().mockResolvedValue({ delegation_depth: 1 }),
    };
    const controller = new DelegationController(
      delegationService as unknown as DelegationService,
      { frontendBaseUrl: 'http://localhost:5173' } as ConfigType<typeof appConfig>,
    );
    const request = {
      headers: { 'x-magic-session': 'verified-session' },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:3000'),
    } as unknown as Request;

    await controller.delegateTask(
      'public-token',
      { new_assignee_name: 'ผู้รับใหม่', expires_in_hours: 24 },
      request,
    );

    expect(delegationService.delegateTask).toHaveBeenCalledWith(
      'public-token',
      expect.objectContaining({ new_assignee_name: 'ผู้รับใหม่' }),
      'http://localhost:5173',
      'verified-session',
    );
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import {
  PublicTeacherAccessController,
  TeacherAccessGrantController,
} from './teacher-access.controller';

describe('Teacher access controller security metadata', () => {
  it('requires the dedicated issuer permission for grant administration', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TeacherAccessGrantController) as unknown[];
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TeacherAccessGrantController,
    ) as string[];

    expect(guards).toEqual([AuthGuard, PermissionsGuard]);
    expect(permissions).toEqual(['manage-teacher-access']);
  });

  it.each([
    'context',
    'roster',
    'attendance',
    'verifyAraId',
    'createAraIdChallenge',
    'approveAraIdChallenge',
    'pollAraIdChallenge',
  ] as const)('marks public %s access as public but IP-throttled', (methodName) => {
    const handler = Object.getOwnPropertyDescriptor(
      PublicTeacherAccessController.prototype,
      methodName,
    )?.value as () => unknown;
    const methodGuards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicTeacherAccessController)).toBe(true);
    expect(methodGuards).toContain(ThrottlerGuard);
  });

  it('requires an AraID session cookie before verifying a teacher link', () => {
    const service = { verifyAraId: jest.fn() };
    const araIdSessionCookie = { readProfileId: jest.fn().mockReturnValue(null) };
    const controller = new PublicTeacherAccessController(
      service as never,
      araIdSessionCookie as never,
      { frontendBaseUrl: 'https://sts.test' } as never,
    );

    expect(() => controller.verifyAraId('link-token', { headers: {} } as never)).toThrow(
      UnauthorizedException,
    );
    expect(service.verifyAraId).not.toHaveBeenCalled();
  });
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import {
  ClassroomAttendanceLinksAdminController,
  ClassroomCheckInAuthController,
} from './classroom-attendance-links.controller';

describe('Classroom attendance links controller security metadata', () => {
  it('keeps admin APIs behind the classroom-link page permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ClassroomAttendanceLinksAdminController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ClassroomAttendanceLinksAdminController)).toEqual([
      'manage-classroom-links',
    ]);
  });

  it.each([
    'context',
    'googleStart',
    'googleCallback',
    'createAraIdChallenge',
    'beginAraIdChallenge',
    'approveAraIdChallenge',
    'pollAraIdChallenge',
    'subjects',
    'roster',
    'studentPhoto',
    'startSession',
    'submitSession',
  ] as const)('marks %s public but IP-throttled', (method) => {
    const handler = Object.getOwnPropertyDescriptor(
      ClassroomCheckInAuthController.prototype,
      method,
    )?.value as () => unknown;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ClassroomCheckInAuthController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(ThrottlerGuard);
  });
});

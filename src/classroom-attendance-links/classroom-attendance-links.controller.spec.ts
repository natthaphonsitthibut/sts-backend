import { ForbiddenException, GoneException } from '@nestjs/common';
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

/**
 * Google navigates the browser straight to this route, so an exception here is
 * not an API error a client can render — it is a raw JSON body filling the
 * teacher's window. Every outcome has to leave as a redirect.
 */
describe('classroom link Google callback outcomes', () => {
  function buildController() {
    const service = { googleCallback: jest.fn() };
    const cookies = { set: jest.fn() };
    const redirects: string[] = [];
    const response = {
      redirect: (_status: number, url: string) => redirects.push(url),
      setHeader: () => undefined,
    };
    const controller = Object.create(ClassroomCheckInAuthController.prototype) as Record<
      string,
      unknown
    > & { googleCallback: (query: unknown, response: unknown) => Promise<void> };
    Object.assign(controller, {
      service,
      cookies,
      app: { frontendBaseUrl: 'https://app.example' },
    });
    return { controller, service, cookies, redirects, response };
  }

  it('sends a successful sign-in back to the link page with its session cookie', async () => {
    const { controller, service, cookies, redirects, response } = buildController();
    service.googleCallback.mockResolvedValue('session-token');

    await controller.googleCallback({ code: 'c', state: 's' }, response);

    expect(cookies.set).toHaveBeenCalledWith(response, 'session-token');
    expect(redirects).toEqual(['https://app.example/classroom?auth=google']);
  });

  it.each([
    ['declined consent', { error: 'access_denied', state: 's' }, undefined, 'declined'],
    ['an expired request', { code: 'c', state: 's' }, new GoneException('gone'), 'expired'],
    [
      'an account that may not open the link',
      { code: 'c', state: 's' },
      new ForbiddenException('ลิงก์ครูนี้เป็นของครูอีกคน'),
      'not-allowed',
    ],
    ['an unexpected failure', { code: 'c', state: 's' }, new Error('boom'), 'failed'],
  ])('redirects instead of throwing on %s', async (_label, query, thrown, reason) => {
    const { controller, service, cookies, redirects, response } = buildController();
    if (thrown) service.googleCallback.mockRejectedValue(thrown);

    await expect(controller.googleCallback(query, response)).resolves.toBeUndefined();

    expect(cookies.set).not.toHaveBeenCalled();
    expect(redirects).toEqual([`https://app.example/classroom?auth=failed&reason=${reason}`]);
  });

  it('never puts the server own wording in the URL', async () => {
    const { controller, service, redirects, response } = buildController();
    service.googleCallback.mockRejectedValue(new ForbiddenException('ลิงก์ครูนี้เป็นของครูอีกคน'));

    await controller.googleCallback({ code: 'c', state: 's' }, response);

    expect(redirects[0]).not.toContain('ครู');
  });
});

import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { GoogleCallbackDto } from '../../classroom-attendance-links/dto/classroom-attendance-links.dto';
import { TaskGoogleCallbackDto } from '../../task/dto/task.dto';
import { TeacherLineCallbackDto } from '../../teacher-line/dto/teacher-line.dto';
import { createValidationException } from '../validation/validation-exception.factory';

/**
 * Regression cover for the 400 every Google sign-in returned: the redirect
 * carries `iss`, `scope`, `authuser` and `prompt`, and the global pipe forbids
 * properties the DTO does not declare. The pipe built here mirrors
 * `src/main.ts` exactly — a route-level pipe cannot soften it, because Nest
 * runs `globalPipes.concat(paramPipes)`.
 */
describe('external OAuth callback query validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: false,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: createValidationException,
  });

  // What Google actually appends to a successful authorization redirect.
  const googleNoise = {
    scope: 'email profile openid https://www.googleapis.com/auth/userinfo.email',
    authuser: '0',
    prompt: 'consent',
    iss: 'https://accounts.google.com',
    hd: 'school.ac.th',
  };

  it.each([
    ['classroom link', GoogleCallbackDto],
    ['follow-up task link', TaskGoogleCallbackDto],
    ['teacher LINE link', TeacherLineCallbackDto],
  ])('accepts the parameters Google appends for the %s callback', async (_label, metatype) => {
    const metadata: ArgumentMetadata = { type: 'query', metatype };

    await expect(
      pipe.transform({ code: 'google-auth-code', state: 'opaque-state', ...googleNoise }, metadata),
    ).resolves.toMatchObject({ code: 'google-auth-code', state: 'opaque-state' });
  });

  it('drops the provider parameters instead of forwarding them to the service', async () => {
    const metadata: ArgumentMetadata = { type: 'query', metatype: GoogleCallbackDto };

    const result = (await pipe.transform(
      { code: 'google-auth-code', state: 'opaque-state', ...googleNoise },
      metadata,
    )) as GoogleCallbackDto;

    // Declared so validation passes, and `whitelist` keeps the values it was
    // given: nothing outside the declared set survives, so the service still
    // reads code/state and the extra parameters are inert.
    const present = Object.entries(result)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);

    expect(present.sort()).toEqual(
      ['authuser', 'code', 'hd', 'iss', 'prompt', 'scope', 'state'].sort(),
    );
  });

  it.each([
    ['classroom link', GoogleCallbackDto],
    ['follow-up task link', TaskGoogleCallbackDto],
    ['teacher LINE link', TeacherLineCallbackDto],
  ])('accepts a declined sign-in on the %s callback', async (_label, metatype) => {
    const metadata: ArgumentMetadata = { type: 'query', metatype };

    // Declining consent returns `error` and no code at all. Each controller
    // turns that into its own failure page, so validation must let it through.
    await expect(
      pipe.transform({ error: 'access_denied', state: 'opaque-state' }, metadata),
    ).resolves.toMatchObject({ error: 'access_denied' });
  });

  it('still rejects a property no provider sends', async () => {
    const metadata: ArgumentMetadata = { type: 'query', metatype: GoogleCallbackDto };

    await expect(
      pipe.transform({ code: 'c', state: 's', role: 'ADMIN' }, metadata),
    ).rejects.toThrow('role: property role should not exist');
  });
});

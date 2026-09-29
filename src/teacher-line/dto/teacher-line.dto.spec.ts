import { ValidationPipe } from '@nestjs/common';
import { TeacherLineCallbackDto } from './teacher-line.dto';

describe('TeacherLineCallbackDto', () => {
  // The same options main.ts gives the global pipe.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (query: Record<string, string>) =>
    pipe.transform(query, { type: 'query', metatype: TeacherLineCallbackDto });

  it('accepts the LIFF parameters LINE adds inside its in-app browser', async () => {
    await expect(
      validate({
        code: 'auth-code',
        state: 'signed-state',
        friendship_status_changed: 'true',
        liffClientId: '2000000000',
        liffRedirectUri: 'https://sts-frontend-gold.vercel.app/api/line/link/callback',
      }),
    ).resolves.toMatchObject({ code: 'auth-code', state: 'signed-state' });
  });
});

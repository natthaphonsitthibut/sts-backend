process.env.LINE_ENABLED = 'true';
process.env.LINE_LOGIN_CHANNEL_ID = 'smoke-login-channel';
process.env.LINE_LOGIN_CHANNEL_SECRET = 'smoke-login-secret';
process.env.LINE_MESSAGING_CHANNEL_ID = 'smoke-channel';
process.env.LINE_MESSAGING_CHANNEL_SECRET = 'smoke-messaging-secret';
process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = 'smoke-token';
process.env.LINE_OA_BASIC_ID = '@sts-smoke';
process.env.FRONTEND_BASE_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
process.env.GOOGLE_LOGIN_TEACHER_LINE_CALLBACK_URL = `http://127.0.0.1:${
  process.env.SMOKE_BACKEND_PORT || 3001
}/api/line/link/google/callback`;

const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { GoogleOidcProvider } = require('../dist/classroom-attendance-links/google-oidc.provider');
const { MESSAGING_PROVIDER } = require('../dist/common/messaging/messaging.types');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const { TeacherLineService } = require('../dist/teacher-line/teacher-line.service');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run LINE link browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_PORT = Number(process.env.SMOKE_BACKEND_PORT || 3001);
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const USERNAME = 'line_link_google_browser_smoke';
const CHANNEL_ID = 'smoke-channel';
const LINE_USER_ID = 'U00000000000000000000googlebrowser';

async function cleanup(dataSource, issuedBy) {
  await dataSource.query(`DELETE FROM teacher_messaging_accounts WHERE provider_channel_id = $1`, [
    CHANNEL_ID,
  ]);
  if (issuedBy) {
    await dataSource.query(`DELETE FROM teacher_line_group_invitations WHERE issued_by = $1`, [
      issuedBy,
    ]);
  }
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'], rawBody: true });
  app.enableCors({ origin: [FRONTEND_URL], credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(BACKEND_PORT, '127.0.0.1');

  const dataSource = app.get(DataSource);
  const service = app.get(TeacherLineService);
  const google = app.get(GoogleOidcProvider);
  const messaging = app.get(MESSAGING_PROVIDER);
  let issuedBy = null;
  let browser = null;

  try {
    await waitFor(async () => {
      const response = await fetch(FRONTEND_URL).catch(() => null);
      return Boolean(response?.ok);
    }, `Frontend is not serving at ${FRONTEND_URL}`);

    const [teacher] = await dataSource.query(
      `SELECT teacher.id::text AS teacher_id, teacher.email, school.id AS school_id,
              school.name AS school_name
       FROM teachers teacher
       JOIN school_teacher_memberships membership
         ON membership.teacher_id = teacher.id
        AND membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL
       JOIN schools school
         ON school.id = membership.school_id
        AND school.school_status = 'ACTIVE'
       JOIN classroom_homeroom_teachers homeroom
         ON homeroom.teacher_membership_id = membership.id
        AND homeroom.school_id = membership.school_id
       JOIN school_classrooms classroom
         ON classroom.id = homeroom.classroom_id
        AND classroom.school_id = homeroom.school_id
        AND classroom.classroom_status = 'ACTIVE'
        AND classroom.deleted_at IS NULL
       JOIN school_terms term
         ON term.id = classroom.school_term_id
        AND term.school_id = classroom.school_id
        AND term.status = 'ACTIVE'
        AND term.deleted_at IS NULL
       WHERE teacher.teacher_status = 'ACTIVE'
         AND teacher.deleted_at IS NULL
         AND NULLIF(btrim(teacher.email), '') IS NOT NULL
       ORDER BY teacher.id LIMIT 1`,
    );
    assert(teacher, 'no active homeroom teacher with an email exists in the smoke database');

    const [actor] = await dataSource.query(
      `INSERT INTO users (
         username, password, "FirstName", "LastName", status, role,
         permissions, data_scope, must_change_password, data_origin_code
       ) VALUES ($1, 'x', 'LINE', 'Browser Smoke', 'ACTIVE', 'ADMIN', '[]'::jsonb,
         $2::jsonb, FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify({ school_ids: [Number(teacher.school_id)] })],
    );
    issuedBy = Number(actor.id);
    await cleanup(dataSource, issuedBy);

    let googleEmail = teacher.email;
    google.authorizationUrl = (state) =>
      `http://127.0.0.1:${BACKEND_PORT}/api/line/link/google/callback` +
      `?code=smoke-google-code&state=${encodeURIComponent(state)}`;
    google.exchange = async () => ({
      subject: 'smoke-google-subject',
      email: googleEmail,
      persistIdentity: false,
    });

    const providerState = { friendState: 'NOT_FRIEND' };
    messaging.isEnabled = () => true;
    messaging.buildAuthorizationUrl = ({ state }) =>
      `http://127.0.0.1:${BACKEND_PORT}/api/line/link/callback` +
      `?code=smoke-line-code&state=${encodeURIComponent(state)}`;
    messaging.buildAddContactUrl = () => 'https://line.me/R/ti/p/@sts-smoke';
    messaging.completeAuthorization = async () => ({
      identity: { providerUserId: LINE_USER_ID, displayName: 'Google Browser Smoke' },
      friendState: providerState.friendState,
    });

    const invitation = await service.issueGroupInvitation({
      schoolId: Number(teacher.school_id),
      schoolName: teacher.school_name,
      issuedBy,
      startsAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      baseUrl: FRONTEND_URL,
    });

    browser = await openChrome();
    await browser.call('Page.enable', {});
    await browser.call('Page.navigate', { url: invitation.url });
    await waitFor(
      async () => (await browser.evaluate(`document.body.innerText`)).includes('เฉพาะครูประจำชั้น'),
      'shared LINE page did not show the homeroom-only rule',
    );
    assert(
      (await browser.evaluate(`document.body.innerText`)).includes('Google') &&
        (await browser.evaluate(`document.body.innerText`)).includes('AraID'),
      'shared LINE page did not offer Google and AraID',
    );

    googleEmail = 'not-a-teacher@sts-smoke.invalid';
    await browser.clickText('Google');
    await waitFor(
      async () => (await browser.evaluate(`document.body.innerText`)).includes('ไม่สำเร็จ'),
      'unknown Google identity did not land on a failure result',
    );

    googleEmail = teacher.email;
    await browser.call('Page.navigate', { url: invitation.url });
    await waitFor(
      async () => (await browser.evaluate(`document.body.innerText`)).includes('เฉพาะครูประจำชั้น'),
      'shared LINE page did not reload after failed Google identity',
    );
    await browser.clickText('Google');
    await waitFor(
      async () => (await browser.evaluate(`document.body.innerText`)).includes('เพิ่มเพื่อน'),
      'non-friend LINE account did not land on the add-friend result',
    );
    const countAfterNonFriend = await dataSource.query(
      `SELECT count(*)::int AS count FROM teacher_messaging_accounts
       WHERE provider_channel_id = $1 AND provider_user_id = $2`,
      [CHANNEL_ID, LINE_USER_ID],
    );
    assert(Number(countAfterNonFriend[0].count) === 0, 'non-friend LINE account was persisted');

    providerState.friendState = 'FRIEND';
    await browser.call('Page.navigate', { url: invitation.url });
    await waitFor(
      async () => (await browser.evaluate(`document.body.innerText`)).includes('เฉพาะครูประจำชั้น'),
      'shared LINE page did not reload for the successful attempt',
    );
    await browser.clickText('Google');
    await waitFor(
      async () => (await browser.evaluate(`document.body.innerText`)).includes('สำเร็จ'),
      'Google + LINE browser flow did not land on success',
    );

    const [account] = await dataSource.query(
      `SELECT teacher_id::text, verified_via, friend_state
       FROM teacher_messaging_accounts
       WHERE provider_channel_id = $1 AND provider_user_id = $2 AND deleted_at IS NULL`,
      [CHANNEL_ID, LINE_USER_ID],
    );
    assert(account?.teacher_id === teacher.teacher_id, 'browser flow bound the wrong teacher');
    assert(account?.verified_via === 'GOOGLE', 'browser flow did not persist GOOGLE');
    assert(account?.friend_state === 'FRIEND', 'browser flow did not persist friendship');

    console.log(
      'LINE link browser smoke passed (Google/AraID choice, homeroom-only copy, unknown Google failure, add-friend state, GOOGLE binding success)',
    );
  } finally {
    if (browser) browser.close();
    await cleanup(dataSource, issuedBy).catch(() => undefined);
    if (issuedBy) {
      await dataSource
        .query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [issuedBy])
        .catch(() => undefined);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

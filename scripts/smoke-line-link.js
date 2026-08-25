process.env.LINE_ENABLED = 'true';
process.env.LINE_LOGIN_CHANNEL_ID = 'smoke-login-channel';
process.env.LINE_LOGIN_CHANNEL_SECRET = 'smoke-login-secret';
process.env.LINE_LOGIN_CALLBACK_URL = 'http://127.0.0.1/api/line/link/callback';
process.env.LINE_MESSAGING_CHANNEL_ID = 'smoke-channel';
process.env.LINE_MESSAGING_CHANNEL_SECRET = 'smoke-messaging-secret';
process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = 'smoke-token';
process.env.LINE_OA_BASIC_ID = '@sts-smoke';
process.env.GOOGLE_LOGIN_TEACHER_LINE_CALLBACK_URL =
  'http://127.0.0.1/api/line/link/google/callback';

const { ForbiddenException } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { GoogleOidcProvider } = require('../dist/classroom-attendance-links/google-oidc.provider');
const { MESSAGING_PROVIDER } = require('../dist/common/messaging/messaging.types');
const { TeacherLineService } = require('../dist/teacher-line/teacher-line.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run LINE link smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME = 'line_link_google_smoke';
const CHANNEL_ID = 'smoke-channel';
const LINE_USER_ID = 'U00000000000000000000000google1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejectsForbidden(operation) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof ForbiddenException, `expected ForbiddenException, got ${error}`);
    return;
  }
  throw new Error('unknown Google identity was accepted');
}

async function cleanup(dataSource, issuedBy) {
  await dataSource.query(
    `DELETE FROM teacher_messaging_accounts WHERE provider_channel_id = $1`,
    [CHANNEL_ID],
  );
  if (issuedBy) {
    await dataSource.query(`DELETE FROM teacher_line_group_invitations WHERE issued_by = $1`, [
      issuedBy,
    ]);
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const service = app.get(TeacherLineService);
  const google = app.get(GoogleOidcProvider);
  const messaging = app.get(MESSAGING_PROVIDER);
  let issuedBy = null;

  try {
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
       ORDER BY teacher.id
       LIMIT 1`,
    );
    assert(teacher, 'no active homeroom teacher with an email exists in the smoke database');

    const [actor] = await dataSource.query(
      `INSERT INTO users (
         username, password, "FirstName", "LastName", status, role,
         permissions, data_scope, must_change_password, data_origin_code
       ) VALUES ($1, 'x', 'LINE', 'Smoke', 'ACTIVE', 'ADMIN', '[]'::jsonb,
         $2::jsonb, FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify({ school_ids: [Number(teacher.school_id)] })],
    );
    issuedBy = Number(actor.id);
    await cleanup(dataSource, issuedBy);

    let googleEmail = 'not-a-teacher@sts-smoke.invalid';
    google.authorizationUrl = (state, nonce, redirectUri) => {
      const url = new URL(redirectUri);
      url.searchParams.set('code', 'smoke-google-code');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      return url.toString();
    };
    google.exchange = async () => ({
      subject: 'smoke-google-subject',
      email: googleEmail,
      persistIdentity: false,
    });

    messaging.isEnabled = () => true;
    messaging.buildAuthorizationUrl = ({ state }) =>
      `https://access.line.me/oauth2/v2.1/authorize?state=${encodeURIComponent(state)}`;
    messaging.buildAddContactUrl = () => 'https://line.me/R/ti/p/@sts-smoke';
    messaging.completeAuthorization = async () => ({
      identity: { providerUserId: LINE_USER_ID, displayName: 'Google Smoke Teacher' },
      friendState: 'FRIEND',
    });

    const invitation = await service.issueGroupInvitation({
      schoolId: Number(teacher.school_id),
      schoolName: teacher.school_name,
      issuedBy,
      startsAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      baseUrl: 'http://127.0.0.1:5174',
    });
    const groupToken = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('token');
    assert(groupToken, 'group invitation did not contain a token fragment');

    const rejectedUrl = new URL(await service.startGroupGoogleAuthorization(groupToken));
    await assertRejectsForbidden(() =>
      service.completeGoogleAuthorization(
        rejectedUrl.searchParams.get('code'),
        rejectedUrl.searchParams.get('state'),
      ),
    );

    googleEmail = teacher.email;
    const googleUrl = new URL(await service.startGroupGoogleAuthorization(groupToken));
    const lineUrl = new URL(
      await service.completeGoogleAuthorization(
        googleUrl.searchParams.get('code'),
        googleUrl.searchParams.get('state'),
      ),
    );
    const outcome = await service.completeAuthorization(
      'smoke-line-code',
      lineUrl.searchParams.get('state'),
      null,
    );
    assert(outcome.outcome === 'SUCCESS', `LINE callback outcome was ${outcome.outcome}`);

    const [account] = await dataSource.query(
      `SELECT teacher_id::text, verified_via, friend_state
       FROM teacher_messaging_accounts
       WHERE provider_channel_id = $1 AND provider_user_id = $2 AND deleted_at IS NULL`,
      [CHANNEL_ID, LINE_USER_ID],
    );
    assert(account?.teacher_id === teacher.teacher_id, 'LINE account bound to the wrong teacher');
    assert(account?.verified_via === 'GOOGLE', 'LINE account did not persist GOOGLE verification');
    assert(account?.friend_state === 'FRIEND', 'LINE friendship state was not persisted');

    console.log(
      'LINE link smoke passed (unknown Google rejected, active homeroom Google accepted, LINE binding persisted as GOOGLE)',
    );
  } finally {
    await cleanup(dataSource, issuedBy);
    if (issuedBy) {
      await dataSource.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [issuedBy]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

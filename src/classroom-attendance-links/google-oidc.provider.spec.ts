import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync, sign } from 'node:crypto';
import { GoogleOidcProvider } from './google-oidc.provider';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });

function idToken(nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'client-id',
      sub: 'provider-subject',
      email: 'Teacher@Example.com',
      email_verified: true,
      nonce,
      iat: now,
      exp: now + 300,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

describe('GoogleOidcProvider', () => {
  const config = {
    mode: 'oidc' as const,
    nodeEnv: 'test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    classroomCallbackUrl: 'https://api.example/api/check-in/auth/google/callback',
    teacherLineCallbackUrl: 'https://api.example/api/line/link/google/callback',
    taskCallbackUrl: 'https://api.example/api/tasks/google/callback',
  };

  afterEach(() => jest.restoreAllMocks());

  it('uses state/nonce and accepts only a verified email for this OAuth client', async () => {
    const provider = new GoogleOidcProvider(config);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id_token: idToken('expected-nonce') }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }),
          {
            status: 200,
            headers: { 'cache-control': 'public, max-age=3600' },
          },
        ),
      );

    const url = new URL(
      provider.authorizationUrl('state-value', 'expected-nonce', config.classroomCallbackUrl),
    );
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('expected-nonce');
    await expect(
      provider.exchange('code', 'expected-nonce', config.classroomCallbackUrl),
    ).resolves.toEqual({
      subject: 'provider-subject',
      email: 'teacher@example.com',
      persistIdentity: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects nonce replay/mismatch even when email is verified', async () => {
    const provider = new GoogleOidcProvider(config);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id_token: idToken('different-nonce') }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }),
          {
            status: 200,
          },
        ),
      );

    await expect(
      provider.exchange('code', 'expected-nonce', config.classroomCallbackUrl),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when Google is not configured', () => {
    const provider = new GoogleOidcProvider({
      mode: 'oidc',
      nodeEnv: 'test',
      clientId: '',
      clientSecret: '',
      classroomCallbackUrl: '',
      teacherLineCallbackUrl: '',
      taskCallbackUrl: '',
    });
    expect(() => provider.authorizationUrl('state', 'nonce', '')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('accepts an email entered in local development without contacting Google', () => {
    const provider = new GoogleOidcProvider({
      mode: 'development',
      nodeEnv: 'development',
      clientId: '',
      clientSecret: '',
      classroomCallbackUrl: 'http://localhost:3000/api/check-in/auth/google/callback',
      teacherLineCallbackUrl: 'http://localhost:3000/api/line/link/google/callback',
      taskCallbackUrl: 'http://localhost:3000/api/tasks/google/callback',
    });
    const fetchMock = jest.spyOn(global, 'fetch');

    expect(provider.developmentIdentity(' Teacher@Example.com ')).toEqual({
      subject: 'sts-local-development',
      email: 'teacher@example.com',
      persistIdentity: false,
    });
    expect(() =>
      provider.authorizationUrl(
        'state-value',
        'unused-nonce',
        'http://localhost:3000/api/check-in/auth/google/callback',
      ),
    ).toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when development mode is configured outside local development', () => {
    const provider = new GoogleOidcProvider({
      mode: 'development',
      nodeEnv: 'production',
      clientId: '',
      clientSecret: '',
      classroomCallbackUrl: 'https://api.example/api/check-in/auth/google/callback',
      teacherLineCallbackUrl: 'https://api.example/api/line/link/google/callback',
      taskCallbackUrl: 'https://api.example/api/tasks/google/callback',
    });

    expect(() => provider.developmentIdentity('teacher@example.com')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('never accepts a client-entered development email in oidc mode', () => {
    const provider = new GoogleOidcProvider(config);

    expect(() => provider.developmentIdentity('teacher@example.com')).toThrow(
      ServiceUnavailableException,
    );
  });
});

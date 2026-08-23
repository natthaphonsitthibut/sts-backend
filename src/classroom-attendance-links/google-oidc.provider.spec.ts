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
    clientId: 'client-id',
    clientSecret: 'client-secret',
    callbackUrl: 'https://api.example/api/check-in/auth/google/callback',
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

    const url = new URL(provider.authorizationUrl('state-value', 'expected-nonce'));
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('expected-nonce');
    await expect(provider.exchange('code', 'expected-nonce')).resolves.toEqual({
      subject: 'provider-subject',
      email: 'teacher@example.com',
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

    await expect(provider.exchange('code', 'expected-nonce')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed when Google is not configured', () => {
    const provider = new GoogleOidcProvider({
      clientId: '',
      clientSecret: '',
      callbackUrl: '',
    });
    expect(() => provider.authorizationUrl('state', 'nonce')).toThrow(ServiceUnavailableException);
  });
});

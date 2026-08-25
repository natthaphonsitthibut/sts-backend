import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { JsonWebKey as NodeJsonWebKey } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import { googleLoginConfig } from '../config/google-login.config';

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
}

interface GoogleIdTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string;
  exp?: number;
  iat?: number;
}

type GoogleJwk = NodeJsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

interface GoogleJwksResponse {
  keys?: GoogleJwk[];
}

interface GoogleIdentity {
  subject: string;
  email: string;
  persistIdentity: boolean;
}

@Injectable()
export class GoogleOidcProvider {
  private jwks = new Map<string, GoogleJwk>();
  private jwksExpiresAt = 0;

  constructor(
    @Inject(googleLoginConfig.KEY)
    private readonly config: ConfigType<typeof googleLoginConfig>,
  ) {}

  authorizationUrl(state: string, nonce: string, redirectUri: string): string {
    this.assertConfigured(redirectUri);
    if (this.config.mode === 'development') {
      throw new ServiceUnavailableException(
        'Google Login development mode ต้องยืนยันผ่านฟอร์มอีเมลใน local',
      );
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async exchange(
    code: string,
    expectedNonce: string,
    redirectUri: string,
  ): Promise<GoogleIdentity> {
    this.assertConfigured(redirectUri);
    if (this.config.mode === 'development') {
      throw new UnauthorizedException('Google Login development mode ไม่รับ OAuth callback');
    }
    const response = await this.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new UnauthorizedException('Google Login ไม่สำเร็จ');
    const tokens = (await response.json()) as GoogleTokenResponse;
    if (!tokens.id_token) throw new UnauthorizedException('Google Login ไม่คืน identity token');

    const info = await this.verifyIdToken(tokens.id_token);
    if (
      !this.hasExpectedAudience(info.aud) ||
      !info.sub ||
      !info.email ||
      info.email_verified !== true ||
      !this.sameSecret(info.nonce, expectedNonce)
    ) {
      throw new UnauthorizedException('Google identity ไม่ผ่านการตรวจสอบ');
    }
    return {
      subject: info.sub,
      email: info.email.trim().toLowerCase(),
      persistIdentity: true,
    };
  }

  developmentIdentity(rawEmail: string): GoogleIdentity {
    this.assertDevelopmentMode();
    const email = rawEmail.trim().toLowerCase();
    if (!email || email.length > 254 || !email.includes('@')) {
      throw new UnauthorizedException('อีเมลสำหรับ development ไม่ถูกต้อง');
    }
    return {
      subject: 'sts-local-development',
      email,
      persistIdentity: false,
    };
  }

  private async verifyIdToken(token: string): Promise<GoogleIdTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Google identity token ไม่ถูกต้อง');
    let header: { alg?: string; kid?: string };
    let claims: GoogleIdTokenClaims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as typeof header;
      claims = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as GoogleIdTokenClaims;
    } catch {
      throw new UnauthorizedException('Google identity token ไม่ถูกต้อง');
    }
    if (header.alg !== 'RS256' || !header.kid) {
      throw new UnauthorizedException('Google identity token ไม่ถูกต้อง');
    }
    let jwk = await this.findSigningKey(header.kid, false);
    if (!jwk) jwk = await this.findSigningKey(header.kid, true);
    if (!jwk || jwk.alg !== 'RS256' || (jwk.use && jwk.use !== 'sig')) {
      throw new UnauthorizedException('Google identity token ไม่ถูกต้อง');
    }
    let validSignature = false;
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      validSignature = verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        Buffer.from(parts[2], 'base64url'),
      );
    } catch {
      validSignature = false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      !validSignature ||
      (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') ||
      typeof claims.exp !== 'number' ||
      claims.exp <= now - 30 ||
      typeof claims.iat !== 'number' ||
      claims.iat > now + 30
    ) {
      throw new UnauthorizedException('Google identity token ไม่ถูกต้อง');
    }
    return claims;
  }

  private async findSigningKey(kid: string, forceRefresh: boolean): Promise<GoogleJwk | undefined> {
    if (forceRefresh || Date.now() >= this.jwksExpiresAt || this.jwks.size === 0) {
      const response = await this.request('https://www.googleapis.com/oauth2/v3/certs');
      if (!response.ok)
        throw new ServiceUnavailableException('ไม่สามารถโหลดกุญแจ Google Login ได้');
      let payload: GoogleJwksResponse;
      try {
        payload = (await response.json()) as GoogleJwksResponse;
      } catch {
        throw new ServiceUnavailableException('กุญแจ Google Login ไม่ถูกต้อง');
      }
      const next = new Map<string, GoogleJwk>();
      for (const key of payload.keys ?? []) {
        if (key.kid) next.set(key.kid, key);
      }
      if (next.size === 0) throw new ServiceUnavailableException('กุญแจ Google Login ไม่ถูกต้อง');
      this.jwks = next;
      const maxAge = Number(
        /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1],
      );
      const ttlSeconds = Number.isFinite(maxAge) ? Math.min(86_400, Math.max(60, maxAge)) : 3_600;
      this.jwksExpiresAt = Date.now() + ttlSeconds * 1000;
    }
    return this.jwks.get(kid);
  }

  private hasExpectedAudience(audience: string | string[] | undefined): boolean {
    return typeof audience === 'string'
      ? audience === this.config.clientId
      : Array.isArray(audience) && audience.includes(this.config.clientId);
  }

  private sameSecret(actual: string | undefined, expected: string): boolean {
    if (!actual) return false;
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private assertConfigured(redirectUri: string): void {
    if (this.config.mode === 'development') {
      this.assertDevelopmentMode();
      if (!redirectUri) {
        throw new ServiceUnavailableException('Google Login development mode ยังไม่ได้ตั้งค่า');
      }
      return;
    }
    if (!this.config.clientId || !this.config.clientSecret || !redirectUri) {
      throw new ServiceUnavailableException('Google Login ยังไม่ได้ตั้งค่า');
    }
  }

  private assertDevelopmentMode(): void {
    if (this.config.mode !== 'development' || this.config.nodeEnv !== 'development') {
      throw new ServiceUnavailableException(
        'Google Login development mode ใช้ได้เฉพาะ local development',
      );
    }
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ServiceUnavailableException('ไม่สามารถติดต่อ Google Login ได้');
    }
  }
}

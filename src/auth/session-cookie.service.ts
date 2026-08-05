import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';
import type { Response } from 'express';
import { authConfig } from '../config/auth.config';

interface SessionPayload {
  sub?: number;
}

/**
 * Owns the admin session cookie: sign a short-lived JWT on login, set it as an
 * httpOnly+SameSite cookie, read/verify it on each request, and clear it on logout.
 * The signing secret lives in config (no hardcoded default) and the cookie is
 * httpOnly so client JS can never read or forge it.
 */
@Injectable()
export class SessionCookieService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  setSession(res: Response, userId: number): void {
    const token = this.jwtService.sign({ sub: userId });
    res.cookie(this.config.cookieName, token, {
      httpOnly: true,
      sameSite: this.config.cookieSameSite,
      secure: this.config.cookieSecure,
      maxAge: this.config.tokenTtlSeconds * 1000,
      path: '/',
    });
  }

  clearSession(res: Response): void {
    res.clearCookie(this.config.cookieName, { path: '/' });
  }

  /** Resolve the authenticated user id from the request's session cookie, or null. */
  readUserId(cookieHeader: string | undefined): number | null {
    const token = this.readCookie(cookieHeader, this.config.cookieName);
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<SessionPayload>(token);
      return typeof payload.sub === 'number' && Number.isInteger(payload.sub) ? payload.sub : null;
    } catch {
      return null;
    }
  }

  private readCookie(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) {
      return null;
    }

    for (const part of cookieHeader.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) {
        continue;
      }
      if (part.slice(0, index).trim() === name) {
        return decodeURIComponent(part.slice(index + 1).trim());
      }
    }
    return null;
  }
}

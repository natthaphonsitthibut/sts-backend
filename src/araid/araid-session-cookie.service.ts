import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { authConfig } from '../config/auth.config';

const ARAID_COOKIE_NAME = 'araid_session';
const ARAID_SESSION_PURPOSE = 'ARAID_SESSION';
const ARAID_LINE_AUTHORIZATION_COOKIE_NAME = 'araid_line_authorization';
const ARAID_TEACHER_ACCESS_AUTHORIZATION_COOKIE_NAME = 'araid_teacher_access_authorization';
const ARAID_TASK_LINK_AUTHORIZATION_COOKIE_NAME = 'araid_task_link_authorization';

interface AraIdSessionPayload {
  authenticatedAt?: number;
  sub?: string;
  purpose?: string;
}

export interface AraIdSessionIdentity {
  authenticatedAt: number;
  profileId: string;
}

@Injectable()
export class AraIdSessionCookieService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  setSession(response: Response, profileId: string): void {
    const token = this.jwtService.sign({
      sub: profileId,
      purpose: ARAID_SESSION_PURPOSE,
      authenticatedAt: Date.now(),
    });
    response.cookie(ARAID_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: this.config.cookieSameSite,
      secure: this.config.cookieSecure,
      maxAge: this.config.tokenTtlSeconds * 1000,
      path: '/',
    });
  }

  clearSession(response: Response): void {
    response.clearCookie(ARAID_COOKIE_NAME, { path: '/' });
  }

  setLineAuthorization(response: Response, token: string, maxAgeSeconds: number): void {
    this.setOpaqueAuthorization(
      response,
      ARAID_LINE_AUTHORIZATION_COOKIE_NAME,
      token,
      maxAgeSeconds,
    );
  }

  readLineAuthorization(cookieHeader: string | undefined): string | null {
    return this.readCookie(cookieHeader, ARAID_LINE_AUTHORIZATION_COOKIE_NAME);
  }

  clearLineAuthorization(response: Response): void {
    response.clearCookie(ARAID_LINE_AUTHORIZATION_COOKIE_NAME, { path: '/' });
  }

  setTeacherAccessAuthorization(response: Response, token: string, maxAgeSeconds: number): void {
    this.setOpaqueAuthorization(
      response,
      ARAID_TEACHER_ACCESS_AUTHORIZATION_COOKIE_NAME,
      token,
      maxAgeSeconds,
    );
  }

  readTeacherAccessAuthorization(cookieHeader: string | undefined): string | null {
    return this.readCookie(cookieHeader, ARAID_TEACHER_ACCESS_AUTHORIZATION_COOKIE_NAME);
  }

  clearTeacherAccessAuthorization(response: Response): void {
    response.clearCookie(ARAID_TEACHER_ACCESS_AUTHORIZATION_COOKIE_NAME, { path: '/' });
  }

  setTaskLinkAuthorization(response: Response, token: string, maxAgeSeconds: number): void {
    this.setOpaqueAuthorization(
      response,
      ARAID_TASK_LINK_AUTHORIZATION_COOKIE_NAME,
      token,
      maxAgeSeconds,
    );
  }

  readTaskLinkAuthorization(cookieHeader: string | undefined): string | null {
    return this.readCookie(cookieHeader, ARAID_TASK_LINK_AUTHORIZATION_COOKIE_NAME);
  }

  clearTaskLinkAuthorization(response: Response): void {
    response.clearCookie(ARAID_TASK_LINK_AUTHORIZATION_COOKIE_NAME, { path: '/' });
  }

  readProfileId(cookieHeader: string | undefined): string | null {
    return this.readSessionIdentity(cookieHeader)?.profileId ?? null;
  }

  readSessionIdentity(cookieHeader: string | undefined): AraIdSessionIdentity | null {
    const token = this.readCookie(cookieHeader, ARAID_COOKIE_NAME);
    if (!token) return null;
    try {
      const payload = this.jwtService.verify<AraIdSessionPayload>(token);
      return payload.purpose === ARAID_SESSION_PURPOSE &&
        typeof payload.sub === 'string' &&
        typeof payload.authenticatedAt === 'number'
        ? { profileId: payload.sub, authenticatedAt: payload.authenticatedAt }
        : null;
    } catch {
      return null;
    }
  }

  private setOpaqueAuthorization(
    response: Response,
    cookieName: string,
    token: string,
    maxAgeSeconds: number,
  ): void {
    response.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: this.config.cookieSameSite,
      secure: this.config.cookieSecure,
      maxAge: maxAgeSeconds * 1000,
      path: '/',
    });
  }

  private readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      if (part.slice(0, separator).trim() === cookieName) {
        try {
          return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

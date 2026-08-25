import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Response } from 'express';
import { authConfig } from '../config/auth.config';
import { CLASSROOM_LINK_SESSION_COOKIE } from './classroom-attendance-links.constants';

@Injectable()
export class ClassroomLinkCookieService {
  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  set(response: Response, token: string): void {
    response.cookie(CLASSROOM_LINK_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: this.config.cookieSameSite,
      secure: this.config.cookieSecure,
      maxAge: this.config.magicSessionTtlSeconds * 1000,
      path: '/api/check-in',
    });
  }

  read(header?: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== CLASSROOM_LINK_SESSION_COOKIE) {
        continue;
      }
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Every API response here is per-user or per-link data, but Express answers a
 * GET with an ETag and no `Cache-Control`, which makes both 200s and errors
 * heuristically cacheable. The browser stores them per URL and may replay them
 * for a different header credential because the cache key ignores that token.
 * Student rosters landing in the on-disk HTTP cache is the same problem wearing
 * a privacy hat.
 *
 * Runs before routing so the header is set no matter how the request ends
 * (guard rejection, exception filter, or a handler). Handlers that need their
 * own directive still set it later and win.
 */
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.setHeader('Cache-Control', 'no-store');
    next();
  }
}

import type { Request } from 'express';

export function resolveExternalBaseUrl(request: Request, configuredBaseUrl?: string): string {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const origin = request.get('origin');
  if (origin) {
    return origin;
  }

  const forwardedProtocol = request.get('x-forwarded-proto');
  const forwardedHost = request.get('x-forwarded-host');
  if (forwardedHost) {
    return `${forwardedProtocol || request.protocol}://${forwardedHost}`;
  }

  return `${request.protocol}://${request.get('host')}`;
}

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { GeoController } from './geo.controller';

describe('GeoController', () => {
  it('protects geocode with auth, permission, and throttling guards', () => {
    const geocodeHandler = Object.getOwnPropertyDescriptor(GeoController.prototype, 'geocode')
      ?.value as () => unknown;
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, GeoController) as unknown[];
    const methodGuards = Reflect.getMetadata(GUARDS_METADATA, geocodeHandler) as unknown[];
    const permissions = Reflect.getMetadata(PERMISSIONS_KEY, geocodeHandler) as string[];

    expect(classGuards).toEqual([AuthGuard, PermissionsGuard]);
    expect(methodGuards).toContain(ThrottlerGuard);
    expect(permissions).toEqual(['create']);
  });
});

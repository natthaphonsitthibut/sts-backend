import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { PublicLocationsController } from './public-locations.controller';

function handler(name: keyof PublicLocationsController): () => unknown {
  return Object.getOwnPropertyDescriptor(PublicLocationsController.prototype, name)
    ?.value as () => unknown;
}

describe('PublicLocationsController access', () => {
  it('serves the area catalog without auth so guest forms can build the cascade', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('getLocations'))).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler('getLocations'))).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('getLocations'))).toBeUndefined();
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('getLocations'))).toBeUndefined();
  });

  it('returns only area names, never student or account data', async () => {
    const attendanceService = {
      getLocations: jest.fn().mockResolvedValue({
        success: true,
        data: { provinces: [], districts: [], subDistricts: [] },
      }),
    };
    const controller = new PublicLocationsController(
      attendanceService as unknown as ConstructorParameters<typeof PublicLocationsController>[0],
    );

    const result = await controller.getLocations();

    expect(attendanceService.getLocations).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.data)).toEqual(['provinces', 'districts', 'subDistricts']);
  });
});

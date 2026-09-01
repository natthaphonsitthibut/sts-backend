import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { AuthGuard, PermissionsGuard } from '../auth';
import { NlQueryController } from './nl-query.controller';

describe('NlQueryController security metadata', () => {
  it('pairs permission metadata with both authentication and permission guards', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, NlQueryController) as unknown[];
    expect(guards).toEqual([AuthGuard, PermissionsGuard]);

    // Metadata is attached to the route handler function itself by SetMetadata.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(PERMISSIONS_KEY, NlQueryController.prototype.ask)).toEqual([
      'nl_query:use',
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(PERMISSIONS_KEY, NlQueryController.prototype.schema)).toEqual([
      'nl_query:use',
    ]);
  });
});

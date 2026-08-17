import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import {
  PublicStudentObservationsController,
  StudentObservationCatalogController,
  StudentObservationsController,
} from './student-observations.controller';

function handler<T>(controller: new (...args: never[]) => T, method: keyof T): () => unknown {
  return Object.getOwnPropertyDescriptor(controller.prototype, method)?.value as () => unknown;
}

describe('Student observation controller security metadata', () => {
  it('requires observation permissions for raw authenticated routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentObservationsController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, StudentObservationsController)).toEqual([
      'students',
    ]);
  });

  it('keeps catalog mutation behind the manage permission', () => {
    for (const method of ['updateDimension', 'updateTag'] as const) {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, handler(StudentObservationCatalogController, method)),
      ).toEqual(['students']);
    }
  });

  it.each(['catalog', 'create', 'list', 'update', 'revisions'] as const)(
    'marks token %s as public but teacher-access throttled',
    (method) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicStudentObservationsController)).toBe(true);
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler(PublicStudentObservationsController, method)),
      ).toContain(ThrottlerGuard);
    },
  );
});

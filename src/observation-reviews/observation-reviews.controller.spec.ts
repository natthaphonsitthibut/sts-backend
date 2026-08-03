import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import {
  HomeVisitRequestReportsController,
  PublicStudentFollowUpRequestsController,
  StudentFollowUpRequestsController,
  StudentRiskReviewController,
  TeacherObservationReportsController,
  TeacherWatchlistController,
} from './observation-reviews.controller';

function handler<T>(controller: new (...args: never[]) => T, method: keyof T): () => unknown {
  return Object.getOwnPropertyDescriptor(controller.prototype, method)?.value as () => unknown;
}

describe('Observation review controller security metadata', () => {
  it('requires manager permission for human risk decisions', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentRiskReviewController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StudentRiskReviewController)).toEqual([
      'manage-student-observations',
    ]);
  });

  it('allows teacher request access but keeps review manager-only', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, StudentFollowUpRequestsController)).toEqual([
      'student-observations',
      'manage-student-observations',
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, handler(StudentFollowUpRequestsController, 'review')),
    ).toEqual(['manage-student-observations']);
  });

  it('exposes only follow-up request create/list to teacher links', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicStudentFollowUpRequestsController)).toBe(true);
    expect(Object.getOwnPropertyNames(PublicStudentFollowUpRequestsController.prototype)).toEqual([
      'constructor',
      'token',
      'create',
      'list',
    ]);
  });

  it.each([TeacherObservationReportsController, HomeVisitRequestReportsController])(
    'keeps manager report routes behind auth and manage permission',
    (controller) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        AuthGuard,
        PermissionsGuard,
      ]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller)).toEqual([
        'manage-student-observations',
      ]);
    },
  );

  it('requires both case-review and observation permissions for the teacher watchlist', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeacherWatchlistController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, TeacherWatchlistController)).toEqual([
      'review-cases',
      'manage-student-observations',
    ]);
  });
});

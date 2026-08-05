import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import {
  StudentClassroomCommentsController,
  StudentRiskReviewController,
  TeacherCommentReportsController,
  TeacherWatchlistController,
} from './observation-reviews.controller';

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

  it('keeps the teacher comment report behind auth and manage permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeacherCommentReportsController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, TeacherCommentReportsController)).toEqual([
      'manage-student-observations',
    ]);
  });

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

  it('protects classroom comment history with observation-manager permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentClassroomCommentsController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StudentClassroomCommentsController)).toEqual([
      'manage-student-observations',
    ]);
  });
});

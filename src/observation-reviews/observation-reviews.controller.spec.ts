import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
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
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StudentRiskReviewController)).toEqual(['students']);
  });

  it('keeps the teacher comment report behind auth and manage permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeacherCommentReportsController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, TeacherCommentReportsController)).toEqual([
      'students',
    ]);
  });

  it('requires both case-review and observation permissions for the teacher watchlist', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeacherWatchlistController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, TeacherWatchlistController)).toEqual([
      'dashboard',
      'students',
    ]);
  });

  // Teacher comments are written from three pages, so any of them opens the
  // history; the guard is an OR set rather than a single required permission.
  it('opens classroom comment history to every page that writes one', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentClassroomCommentsController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, StudentClassroomCommentsController)).toEqual([
      'students',
      'classrooms',
      'manage-school-structure',
      'attendance',
    ]);
  });
});

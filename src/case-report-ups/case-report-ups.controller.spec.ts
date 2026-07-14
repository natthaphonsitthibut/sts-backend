import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import {
  CaseReportUpMutationController,
  CaseReportUpQueueController,
} from './case-report-ups.controller';

function getMethod(target: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(target, name)?.value;
}

describe('Case report-up controller permissions', () => {
  it('keeps mutation school-owned and denies executive aggregate permission', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        getMethod(CaseReportUpMutationController.prototype, 'reportUp'),
      ),
    ).toEqual(['review-cases', 'report-up-cases']);
  });

  it('requires report-up-cases for raw report-up rows', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        getMethod(CaseReportUpMutationController.prototype, 'listForCase'),
      ),
    ).toEqual(['report-up-cases']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        getMethod(CaseReportUpQueueController.prototype, 'list'),
      ),
    ).toEqual(['report-up-cases']);
  });
});

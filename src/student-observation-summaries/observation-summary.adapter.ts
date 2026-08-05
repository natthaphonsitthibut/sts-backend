import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  ObservationSummaryAdapterInput,
  ObservationSummaryAdapterResult,
} from './student-observation-summary.types';

export const OBSERVATION_SUMMARY_ADAPTER = Symbol('OBSERVATION_SUMMARY_ADAPTER');

export interface ObservationSummaryAdapter {
  generate(input: ObservationSummaryAdapterInput): Promise<ObservationSummaryAdapterResult>;
}

@Injectable()
export class DisabledObservationSummaryAdapter implements ObservationSummaryAdapter {
  generate(): Promise<ObservationSummaryAdapterResult> {
    throw new ServiceUnavailableException('ระบบสรุปอัตโนมัติยังไม่เปิดใช้งาน');
  }
}

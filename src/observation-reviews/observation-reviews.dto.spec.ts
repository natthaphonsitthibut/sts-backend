import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateFollowUpRequestDto,
  CreateRiskReviewDto,
  ReviewFollowUpRequestDto,
} from './dto/observation-reviews.dto';

describe('Observation review DTO contracts', () => {
  it('accepts an explicit risk decision with observation revision sources', async () => {
    const dto = plainToInstance(CreateRiskReviewDto, {
      expectedRevision: 0,
      humanRiskDecision: 'WATCH',
      decisionReason: '  ต้องติดตามข้อมูลเพิ่ม  ',
      sourceObservations: [{ observationId: 9, revision: 2 }],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.decisionReason).toBe('ต้องติดตามข้อมูลเพิ่ม');
  });

  it('allows empty review sources but rejects unsupported risk decisions', async () => {
    const dto = plainToInstance(CreateRiskReviewDto, {
      expectedRevision: 0,
      humanRiskDecision: 'AUTO_OPEN_CASE',
      decisionReason: 'reason',
      sourceObservations: [],
    });
    expect((await validate(dto)).map((error) => error.property)).toEqual(['humanRiskDecision']);
  });

  it('allows only NORMAL/URGENT request urgency and explicit review transitions', async () => {
    const request = plainToInstance(CreateFollowUpRequestDto, {
      assignmentId: 31,
      urgency: 'CRITICAL',
      reason: 'reason',
      sourceObservations: [{ observationId: 9, revision: 2 }],
    });
    const review = plainToInstance(ReviewFollowUpRequestDto, {
      expectedRevision: 1,
      decision: 'AUTO_ASSIGN',
      reason: 'reason',
    });
    expect((await validate(request)).map((error) => error.property)).toContain('urgency');
    expect((await validate(review)).map((error) => error.property)).toContain('decision');
  });
});

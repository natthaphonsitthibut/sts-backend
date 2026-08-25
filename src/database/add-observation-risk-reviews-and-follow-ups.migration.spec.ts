import type { QueryRunner } from 'typeorm';
import { AddObservationRiskReviewsAndFollowUps20260714240000 } from './migrations/20260714240000-AddObservationRiskReviewsAndFollowUps';

describe('AddObservationRiskReviewsAndFollowUps20260714240000', () => {
  it('creates reversible review/follow-up schema with explicit integrity constraints', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    const migration = new AddObservationRiskReviewsAndFollowUps20260714240000();

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const up = statements[0];
    const down = statements[1];
    expect(up).toContain('CREATE TABLE student_observation_risk_reviews');
    expect(up).toContain('calculated_attendance_risk VARCHAR(16) NOT NULL');
    expect(up).toContain('teacher_concern_signal VARCHAR(16) NOT NULL');
    expect(up).toContain('human_risk_decision VARCHAR(24) NOT NULL');
    expect(up).toContain(
      'REFERENCES student_observation_revisions(observation_id, revision_number)',
    );
    expect(up).toContain('CREATE TABLE student_follow_up_requests');
    expect(up).toContain("WHERE status = 'PENDING_REVIEW'");
    expect(up).toContain("CHECK (urgency IN ('NORMAL', 'URGENT'))");
    expect(up).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(down).toContain('DROP TABLE IF EXISTS student_follow_up_request_sources');
    expect(down).toContain('DROP TABLE IF EXISTS student_observation_risk_reviews');
  });
});

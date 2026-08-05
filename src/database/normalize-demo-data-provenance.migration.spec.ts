import type { QueryRunner } from 'typeorm';
import { NormalizeDemoDataProvenance20260724130000 } from './migrations/20260724130000-NormalizeDemoDataProvenance';

describe('NormalizeDemoDataProvenance20260724130000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new NormalizeDemoDataProvenance20260724130000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('retags demo users and backfills only uniquely inferred actors', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE demo_provenance_user_origin_backup_20260724');
    expect(sql).toContain('CREATE TABLE demo_provenance_case_review_backup_20260724');
    expect(sql).toContain('CREATE TABLE demo_provenance_task_actor_backup_20260724');
    expect(sql).toContain('CREATE TABLE demo_provenance_submission_actor_backup_20260724');
    expect(sql).toContain('CREATE TABLE demo_provenance_attendance_session_backup_20260724');
    expect(sql).toContain('CREATE TABLE demo_provenance_attendance_backup_20260724');
    expect(sql).toContain('HAVING COUNT(DISTINCT actor.id) = 1');
    expect(sql).toContain('HAVING COUNT(DISTINCT link.created_by) = 1');
    expect(sql).toContain("SET data_origin_code = 'AUTOMATED_TEST'");
    expect(sql).toContain(
      'SET created_by = COALESCE(task.created_by, backup.backfilled_actor_user_id)',
    );
    expect(sql).toContain('HAVING COUNT(DISTINCT teacher.id) = 1');
    expect(sql).toContain('SET "RecordedBy" = actor.username');
    expect(sql).toContain("SET data_origin_code = 'DEMO'");
    expect(sql).toContain("'9900010000017'");
    expect(sql).toContain("lower(split_part(target.email, '@', 2)) = 'sts-demo.ac.th'");
    expect(sql).toContain('AS persona(username, legacy_person_id)');
    expect(sql).toContain('users."PersonID_Onec" = persona.legacy_person_id');
  });

  it('restores previous provenance and actor values', async () => {
    const sql = await collectSql('down');

    expect(sql).not.toContain("SET data_origin_code = 'OPERATIONAL'");
    expect(sql).toContain('SET data_origin_code = backup.previous_data_origin_code');
    expect(sql).toContain("target.data_origin_code IN ('AUTOMATED_TEST', 'DEMO')");
    expect(sql).toContain(
      'WHEN backup.previous_created_by IS NULL AND task.created_by = backup.backfilled_actor_user_id THEN NULL',
    );
    expect(sql).toContain('SET source_actor_user_id = backup.previous_source_actor_user_id');
    expect(sql).toContain('DROP TABLE demo_provenance_submission_actor_backup_20260724');
    expect(sql).toContain('DROP TABLE demo_provenance_attendance_backup_20260724');
    expect(sql).toContain('DROP TABLE demo_provenance_attendance_session_backup_20260724');
    expect(sql).toContain('DROP TABLE demo_provenance_task_actor_backup_20260724');
    expect(sql).toContain('DROP TABLE demo_provenance_case_review_backup_20260724');
    expect(sql).toContain('DROP TABLE demo_provenance_user_origin_backup_20260724');
  });
});

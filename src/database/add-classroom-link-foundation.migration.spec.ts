import type { QueryRunner } from 'typeorm';
import { AddClassroomLinkFoundation20260827200000 } from './migrations/20260827200000-AddClassroomLinkFoundation';

describe('AddClassroomLinkFoundation20260827200000', () => {
  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AddClassroomLinkFoundation20260827200000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('creates explicit identity, homeroom and classroom-link contracts', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE teacher_external_identities');
    expect(sql).toContain("CHECK (provider IN ('GOOGLE', 'THAID'))");
    expect(sql).toContain('UNIQUE (provider, provider_subject)');
    expect(sql).toContain('UNIQUE (teacher_id, provider)');
    expect(sql).toContain(
      'FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE ON UPDATE CASCADE',
    );

    expect(sql).toContain('CREATE TABLE classroom_homeroom_teachers');
    const homeroomTableSql = sql.match(
      /CREATE TABLE classroom_homeroom_teachers \([\s\S]*?\);/,
    )?.[0];
    expect(homeroomTableSql).toBeDefined();
    expect(homeroomTableSql).not.toContain('deleted_at');
    expect(homeroomTableSql).not.toContain('deleted_by');
    expect(sql).toContain(
      'FOREIGN KEY (classroom_id, school_id) REFERENCES school_classrooms(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY (teacher_membership_id, school_id) REFERENCES school_teacher_memberships(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );

    expect(sql).toContain('CREATE TABLE classroom_attendance_links');
    expect(sql).toContain('UNIQUE (classroom_id)');
    expect(sql).toContain(
      'FOREIGN KEY (classroom_id, school_term_id, school_id) REFERENCES school_classrooms(id, school_term_id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain("CHECK (token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("CHECK (link_status IN ('ACTIVE', 'INACTIVE'))");
  });

  it('fails closed before and after the homeroom backfill', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain(
      'every active classroom must have exactly one active HOMEROOM assignment',
    );
    expect(sql).toContain(
      'active HOMEROOM source has an inactive or invalid classroom, membership, or teacher',
    );
    expect(sql).toContain('INSERT INTO classroom_homeroom_teachers');
    expect(sql).toContain('FULL JOIN classroom_homeroom_teachers target');
    expect(sql).toContain('classroom_homeroom_teachers reconciliation failed after backfill');
  });

  it('keeps the additive homeroom relation synchronized from legacy writes', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION sync_classroom_homeroom_teacher(');
    expect(sql).toContain('ON CONFLICT (classroom_id) DO UPDATE');
    expect(sql).toContain('DELETE FROM classroom_homeroom_teachers');
    expect(sql).toContain(
      'CREATE TRIGGER trg_sync_classroom_homeroom_teacher AFTER INSERT OR UPDATE OR DELETE ON classroom_teacher_assignments',
    );
  });

  it('blocks Data API roles from the new public-schema tables', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('ALTER TABLE teacher_external_identities ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE classroom_homeroom_teachers ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE classroom_attendance_links ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("ARRAY['anon', 'authenticated']");
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE teacher_external_identities, classroom_homeroom_teachers, classroom_attendance_links',
    );
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON SEQUENCE teacher_external_identities_id_seq');
    expect(sql).toContain('SECURITY INVOKER');
  });

  it('refuses a destructive rollback after consumers write data', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('Refusing rollback: teacher_external_identities contains consumer data');
    expect(sql).toContain('Refusing rollback: classroom_attendance_links contains consumer data');
    expect(sql).toContain(
      'classroom_homeroom_teachers no longer matches the legacy HOMEROOM source',
    );
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_sync_classroom_homeroom_teacher');
    expect(sql).toContain('DROP TABLE classroom_attendance_links');
    expect(sql).toContain('DROP TABLE classroom_homeroom_teachers');
    expect(sql).toContain('DROP TABLE teacher_external_identities');
  });
});

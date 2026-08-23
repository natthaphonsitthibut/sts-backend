import { CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL } from './customer-alignment-bootstrap-sql';

describe('CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL', () => {
  it('orders the fresh feature schema by migration dependency', () => {
    const sql = CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL;
    const dependencyMarkers = [
      'school_classrooms',
      'classroom_teacher_assignments',
      'classroom_homeroom_teachers',
      'classroom_attendance_links',
      'teacher_access_grants',
      'student_observations',
      'student_observation_risk_reviews',
      'student_observation_summaries',
    ];
    for (let index = 1; index < dependencyMarkers.length; index += 1) {
      expect(
        sql.indexOf(`CREATE TABLE IF NOT EXISTS ${dependencyMarkers[index - 1]}`),
      ).toBeLessThan(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${dependencyMarkers[index]}`));
    }
  });

  it('contains every final feature table as an idempotent create', () => {
    const expectedTables = [
      'school_classrooms',
      'school_teacher_memberships',
      'classroom_teacher_assignments',
      'teacher_external_identities',
      'classroom_homeroom_teachers',
      'classroom_attendance_links',
      'school_structure_backfill_issues',
      'teacher_access_grants',
      'teacher_access_grant_capabilities',
      'teacher_access_grant_assignments',
      'observation_dimensions',
      'observation_behavior_tags',
      'student_observations',
      'student_observation_tags',
      'student_observation_revisions',
      'student_observation_risk_reviews',
      'student_observation_risk_review_sources',
      'student_observation_summaries',
      'student_observation_summary_sources',
    ];
    for (const table of expectedTables) {
      expect(CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL).toContain(
        `CREATE TABLE IF NOT EXISTS ${table}`,
      );
    }
  });

  it('mirrors canonical enrollment, assignment, observation and citation FKs', () => {
    const sql = CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL;
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS school_term_id BIGINT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS classroom_id BIGINT');
    expect(sql).toContain('FOREIGN KEY (student_uuid, school_id)');
    expect(sql).toContain('REFERENCES student_term(student_uuid, "SchoolID_Onec")');
    expect(sql).toContain(
      'REFERENCES student_observation_revisions(observation_id, revision_number)',
    );
    expect(sql).toContain(
      'REFERENCES classroom_teacher_assignments(id, teacher_membership_id, school_id, classroom_id)',
    );
    expect(sql).toContain('REFERENCES teachers(id)');
    expect(sql).toContain('REFERENCES school_classrooms(id, school_term_id, school_id)');
    expect(sql).toContain('REFERENCES school_teacher_memberships(id, school_id)');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
  });

  it('keeps the new room-link foundation private and legacy-write compatible', () => {
    const sql = CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL;
    expect(sql).toContain('ALTER TABLE teacher_external_identities ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE classroom_homeroom_teachers ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE classroom_attendance_links ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("ARRAY['anon', 'authenticated']");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION sync_classroom_homeroom_teacher(');
    expect(sql).toContain('DELETE FROM classroom_homeroom_teachers');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON classroom_teacher_assignments');
  });

  it('keeps import targets, quarantine codes, indexes and triggers idempotent', () => {
    const sql = CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL;
    expect(sql).toContain("'school_teacher_membership'");
    expect(sql).toContain("'school_classroom'");
    expect(sql).toContain("'classroom_teacher_assignment'");
    expect(sql).toContain("'student_exit_events'");
    expect(sql).toContain("'BLANK_TEACHER_USERNAME'");
    expect(sql).toContain("'INVALID_TEACHER_START_DATE'");
    expect(sql).toContain("'TEACHER_MEMBERSHIP_NOT_FOUND'");
    expect(sql).toContain("'ASSIGNMENT_CONFLICT'");
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS student_follow_up_requests');
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS student_follow_up_request_sources');
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS student_observations \([\s\S]*?deleted_at TIMESTAMPTZ/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_student_observations_student_timeline[\s\S]*?WHERE deleted_at IS NULL/,
    );
    expect(sql).toContain('CREATE OR REPLACE FUNCTION resolve_student_term_structure_refs()');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION mark_student_observation_summaries_stale()');
    expect(sql).toContain("WHERE tgname = 'trg_student_observation_summary_stale'");
  });

  it('does not perform historical feature backfills', () => {
    const sql = CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL;
    expect(sql).not.toContain('UPDATE student_term enrollment');
    expect(sql).not.toContain('INSERT INTO school_classrooms (');
    expect(sql).not.toContain('INSERT INTO school_teacher_memberships (');
    expect(sql).not.toContain('UPDATE users\n  SET permissions');
  });
});

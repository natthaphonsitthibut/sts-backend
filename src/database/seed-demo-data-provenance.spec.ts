import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readScript(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'scripts', fileName), 'utf8');
}

function readSeed(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'data', 'seeds', fileName), 'utf8');
}

describe('demo data provenance seed contracts', () => {
  it('attributes demo attendance to the teacher who taught the round', () => {
    const source = readScript('seed-demo-attendance-history.js');

    // A round names a teacher, not an account: the teacher who holds the
    // classroom that day, resolved through their membership.
    expect(source).toContain('recorded_by_teacher_id');
    expect(source).toContain('JOIN homeroom_teachers ht');
    expect(source).toContain('JOIN school_teacher_memberships membership');
    expect(source).not.toContain('teacher_user_id');
    expect(source).toMatch(/created_by = EXCLUDED\.created_by/);
    expect(source).not.toContain("'seed-demo-attendance-history'");
  });

  it('attributes anomaly attendance to a real teacher and a DEMO admin', () => {
    const source = readScript('seed-attendance-anomalies.js');

    expect(source).toContain('Refusing to run attendance anomaly seed');
    // The round is the teacher's; the audit columns belong to the DEMO account
    // running the seed, because those columns reference `users`.
    expect(source).toContain("teacher.teacher_status = 'ACTIVE'");
    expect(source).toContain('recorded_by_teacher_id');
    expect(source).toContain("data_origin_code = 'DEMO'");
    expect(source).toContain('structuralActor.id');
    expect(source).not.toContain("'seed-attendance-anomalies'");
  });

  it('uses a real DEMO teacher for the case scenario', () => {
    const source = readScript('seed-demo-case-scenarios.js');

    expect(source).toContain("data_origin_code = 'DEMO'");
    expect(source).toContain('actor.display_name');
    expect(source).toContain('actor.email');
    // The assignee is a teacher row; the audit columns stay on the DEMO account.
    expect(source).toContain('FROM teachers teacher');
    expect(source).toContain("username = 'orathai.b'");
    expect(source).toContain('[taskId, CASE_ID, caseRecord.school_id, creator.id]');
    expect(source).toContain('created_by, updated_by');
    expect(source).not.toMatch(/seed-task-|seed-link-|@example\./);
  });

  it('requires a DEMO actor for the student status roster', () => {
    const source = readScript('seed-demo-student-status-roster.js');

    expect(source).toContain("data_origin_code = 'DEMO'");
    expect(source).toContain('No active DEMO administrator is available for seed attribution');
  });

  it('ships a strict aggregate audit without exposing row-level user data', () => {
    const source = readScript('audit-demo-data-provenance.js');

    expect(source).toContain("process.argv.includes('--strict')");
    expect(source).toContain('active_automated_users');
    expect(source).toContain('demo_attendance_actor_issues');
    expect(source).not.toMatch(/SELECT\s+\*/i);
  });

  it('retags temporary operational smoke users during cleanup', () => {
    for (const fileName of ['smoke-home-visit-browser.js', 'smoke-profile-self-edit-browser.js']) {
      const source = readScript(fileName);
      const cleanup = source.slice(source.indexOf("SET status = 'DISABLED'"));

      expect(cleanup).toContain("data_origin_code = 'AUTOMATED_TEST'");
    }
  });

  it('resolves SQL seed actors by stable DEMO usernames instead of numeric IDs', () => {
    const states = readSeed('demo-states.sql');
    const timetable = readSeed('demo-timetable.sql');

    expect(states).toContain("username = 'orathai.b' AND data_origin_code = 'DEMO'");
    expect(states).toContain("username = 'narongsak.k' AND data_origin_code = 'DEMO'");
    expect(states).not.toContain('weerapon.k@sts-demo.ac.th');
    expect(timetable).toContain('homeroom.teacher_user_id');
    expect(timetable).toContain('ON CONFLICT (');
    expect(timetable).not.toMatch(/updated_by = 9|THEN 12|THEN 13/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(
    process.cwd(),
    'src/database/migrations/20260810140000-RemediateUnsafeShowcaseArtifacts.ts',
  ),
  'utf8',
);

describe('unsafe showcase artifact remediation migration', () => {
  it('removes marker attendance outside the named school with an active DEMO actor', () => {
    expect(source).toContain("'SYSTEM:THEPSIRIN_SHOWCASE'");
    expect(source).toContain("'SYSTEM:THEPSIRIN_RISK_SHOWCASE'");
    expect(source).toContain("'SYSTEM:DEMO_RISK_DISTRIBUTION'");
    expect(source).toContain("demo_actor.data_origin_code = 'DEMO'");
    expect(source).toContain('โรงเรียนเทพศิรินทร์ราชดำริ');
    expect(source).toContain('DELETE FROM student_risk_profiles');
  });

  it('removes the legacy global calendar marker', () => {
    expect(source).toContain('ข้อมูลสาธิตความเสี่ยงทุกโรงเรียน');
    expect(source).toContain("calendar_day.source = 'BACKFILL'");
  });

  it('rotates and locks only links whose hash matches the predictable legacy token', () => {
    expect(source).toContain("digest('thepsirin-showcase-' || tracked_case.id::text");
    expect(source).toContain("token_hash = encode(gen_random_bytes(32), 'hex')");
    expect(source).toContain("admin_lock_reason = 'SHOWCASE_TOKEN_ROTATED'");
    expect(source).toContain('admin_locked = 1');
  });

  it('does not guess which unmarked address or membership values to erase', () => {
    expect(source).not.toContain('UPDATE student_term');
    expect(source).not.toContain('DELETE FROM school_teacher_memberships');
  });
});

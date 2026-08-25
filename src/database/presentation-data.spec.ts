import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('presentation data convergence contracts', () => {
  it('keeps the presentation origin honest but hidden in the final bootstrap', () => {
    const source = read('src/database/bootstrap-sql.ts');

    expect(source).toContain("('DEMO', 'ข้อมูลสำหรับการนำเสนอ', FALSE, 20)");
    expect(source).not.toContain("('DEMO', 'ข้อมูลสาธิต', TRUE, 20)");
  });

  it('uses the non-deliverable canonical presentation domain in the current school seed', () => {
    const source = read('scripts/seed-demo-school-structure.js');

    expect(source).toContain("const PRESENTATION_EMAIL_DOMAIN = 'school.sts.local'");
    expect(source).not.toContain('sts-demo.ac.th');
  });

  it('ships an aggregate-only strict verifier for target counts and visible markers', () => {
    const source = read('scripts/audit-demo-data-provenance.js');

    expect(source).toContain('presentation_teacher_baseline_issues');
    expect(source).toContain('presentation_origin_catalog_issues');
    expect(source).toContain('referral_directory_issues');
    expect(source).toContain('legacy_presentation_email_rows');
    expect(source).toContain('forbidden_business_surface_rows');
    expect(source).toContain('presentation_guest_submission_issues');
    expect(source).toContain('submission.created_by IS NOT NULL');
    expect(source).toContain("status: 'presentation_data_audit'");
    expect(source).not.toMatch(/SELECT\s+\*/i);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('demo school structure seed security contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'scripts/seed-demo-school-structure.js'),
    'utf8',
  );

  it('rotates existing demo teacher passwords and verifies the resulting hash', () => {
    expect(source).toMatch(/UPDATE users teacher[\s\S]*?password = \$1/);
    expect(source).toMatch(
      /ON CONFLICT \(username\) DO UPDATE[\s\S]*?password = EXCLUDED\.password/,
    );
    expect(source).toContain('synthetic_teacher_password_hash_mismatches');
  });

  it('uses DEMO actors and assigns every generated teacher a realistic demo email', () => {
    expect(source).toContain("data_origin_code = 'DEMO'");
    expect(source).toContain('email: `${identity.username}@sts-demo.ac.th`');
    expect(source).toContain('synthetic_teacher_email_issues');
    expect(source).toMatch(/email = EXCLUDED\.email/);
  });
});

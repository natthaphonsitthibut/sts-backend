import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('demo school structure seed security contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'scripts/seed-demo-school-structure.js'),
    'utf8',
  );

  it('creates teachers as people, never as login accounts', () => {
    // Teachers reach the system through an access link. A seed that minted a
    // login for one would hand out a credential nobody intends to exist.
    expect(source).toContain('INSERT INTO teachers (');
    expect(source).not.toMatch(/INSERT INTO users[\s\S]{0,400}'TEACHER'/);
    expect(source).not.toContain('password');
    expect(source).toContain('synthetic_teacher_accounts');
    expect(source).toContain('A generated demo teacher still has a login account');
  });

  it('gives every generated teacher a realistic demo email and an active membership', () => {
    expect(source).toContain('email: `${identity.username}@sts-demo.ac.th`');
    expect(source).toContain('synthetic_teacher_status_issues');
    expect(source).toContain('synthetic_teachers_without_membership');
    // Re-running the seed must find the same teacher by the email that is
    // unique in the schema, not create a second row for the same person.
    expect(source).toMatch(/ON CONFLICT \(lower\(btrim\(email\)\)\)/);
  });
});

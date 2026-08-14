import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readMigration(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'src', 'database', 'migrations', fileName), 'utf8');
}

describe('showcase migration security contracts', () => {
  it.each([
    '20260807120000-SeedDemoShowcaseBasics.ts',
    '20260807140000-CompleteDemoStudentAddresses.ts',
    '20260807150000-SeedThepsirinRiskShowcase.ts',
    '20260807160000-SeedDemoRiskDistribution.ts',
  ])('%s requires an active DEMO actor and a named showcase school', (fileName) => {
    const source = readMigration(fileName);

    expect(source).toContain("demo_actor.data_origin_code = 'DEMO'");
    expect(source).toContain('โรงเรียนเทพศิรินทร์ราชดำริ');
  });

  it('uses an unguessable task-link hash instead of deriving it from the case id', () => {
    const source = readMigration('20260807130000-SeedThepsirinCaseShowcase.ts');

    expect(source).toContain("account.data_origin_code = 'DEMO'");
    expect(source).toContain('โรงเรียนเทพศิรินทร์ราชดำริ');
    expect(source).toContain("encode(gen_random_bytes(32), 'hex')");
    expect(source).not.toContain('thepsirin-showcase-${caseId}');
  });

  it('ships a forward remediation for environments that already ran the unsafe versions', () => {
    const source = readMigration('20260810140000-RemediateUnsafeShowcaseArtifacts.ts');

    expect(source).toContain('DELETE FROM attendance');
    expect(source).toContain('SHOWCASE_TOKEN_ROTATED');
    expect(source).toContain('ข้อมูลสาธิตความเสี่ยงทุกโรงเรียน');
  });
});

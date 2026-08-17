import { VALID_PERMISSION_IDS } from '../auth/permissions.constants';
import { CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL } from './customer-alignment-bootstrap-sql';
import { DATABASE_BASELINE_SQL } from './bootstrap-sql';

/**
 * The bootstrap catalogue seeds permission ids as bare SQL strings, so nothing
 * in the type system notices when the catalogue renames one. It happened: after
 * the 2026-08-17 collapse to one permission per page, the catalogue still seeded
 * `review-cases` and `close-case` for `case_review_actions` — and because that
 * INSERT is `ON CONFLICT DO UPDATE`, running it would have written the retired
 * ids back over a migrated database, leaving nobody able to close a case.
 *
 * `bootstrap:verify-parity` cannot catch this: it hashes the catalogue against
 * itself. This does, by reading every permission id the catalogue mentions and
 * requiring it to still exist.
 */
const CATALOGUE_SQL = [DATABASE_BASELINE_SQL, CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL].join('\n');

/**
 * Permission ids seeded into the two `required_permission*` columns.
 *
 * Only statements that name one of those columns are read, and inside them only
 * lower-case hyphenated literals: status codes are upper case (`RESOLVED`,
 * `FOLLOW_UP`) and labels are Thai, so a permission id is the one thing left.
 */
function seededRequiredPermissions(sql: string): string[] {
  const found = new Set<string>();

  for (const statement of sql.split(';')) {
    if (!statement.includes('required_permission')) continue;
    for (const [, id] of statement.matchAll(/'([a-z][a-z-]{2,})'/g)) found.add(id);
  }
  return [...found];
}

/** Permission ids appended to a role's `default_permissions` jsonb list. */
function seededRolePermissions(sql: string): string[] {
  const found = new Set<string>();

  for (const [, list] of sql.matchAll(/default_permissions\s*\|\|\s*'(\[[^']*\])'::jsonb/g)) {
    for (const id of JSON.parse(list) as string[]) found.add(id);
  }
  return [...found];
}

describe('bootstrap catalogue permission ids', () => {
  it('mentions permission ids that still exist', () => {
    const mentioned = [
      ...seededRequiredPermissions(CATALOGUE_SQL),
      ...seededRolePermissions(CATALOGUE_SQL),
    ];
    // A regex that matches nothing would make this pass without checking
    // anything, so prove it found the seeds it is meant to police.
    expect(mentioned).toContain('dashboard');
    expect(mentioned.length).toBeGreaterThan(3);

    const retired = mentioned.filter((id) => !VALID_PERMISSION_IDS.includes(id));
    expect(retired).toEqual([]);
  });

  it('never seeds a permission for a role the catalogue does not create', () => {
    // `student-observations` was granted to `TEACHER` long after teachers stopped
    // having accounts, so the statement could not do anything but confuse.
    const rolesGranted = [
      ...CATALOGUE_SQL.matchAll(
        /default_permissions\s*\|\|\s*'\[[^']*\]'::jsonb\s*WHERE\s+name\s+(?:IN\s*\(([^)]*)\)|=\s*('[^']*'))/g,
      ),
    ].flatMap(([, list, single]) =>
      (list ?? single ?? '').split(',').map((name) => name.trim().replace(/^'|'$/g, '')),
    );

    expect(rolesGranted.length).toBeGreaterThan(0);
    for (const role of rolesGranted) {
      expect(CATALOGUE_SQL).toContain(`'${role}'`);
      expect(['ADMIN', 'DIRECTOR', 'EXECUTIVE']).toContain(role);
    }
  });
});

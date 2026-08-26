# Canonical development database baseline

`../backups/sts_backup.sql.gz` contains production-shaped presentation data after the current local migrations. It is not a raw production export.

Generation contract:

1. Use production only for read-only aggregate/schema evidence.
2. Clone the verified local target database to `sts_dev_baseline`. The sanitizer refuses any database whose name does not end in `baseline`, and the `baseline-export` compose profile dumps exactly this name.
3. Apply `sanitize-dev-baseline.sql` to revoke credentials, remove runtime/provider artifacts, and regenerate identity.
4. Run `verify-dev-baseline.sql` before dumping, and update `production-target-manifest.json` plus the migration count the verifier asserts.
5. Dump with PostgreSQL 15 using `pg_dump --clean --if-exists --no-owner --no-privileges`, gzip it, and restore it twice into a fresh PostgreSQL 15 data directory.
6. Restore the gzip into an empty database and run `pnpm migration:run`. It must report `No migrations are pending`.

Identity is regenerated, not merely assumed synthetic. Every national-id-shaped
value — student enrollments, their canonical identifier rows, users, teachers and
external users — is rewritten from the row's own surrogate key, keeping its
layout but deliberately storing the wrong Thai check digit, so no value in the
dump can be an issued citizen id. House numbers are regenerated the same way and
home coordinates are dropped with the geocode cache. `verify-dev-baseline.sql`
recomputes all of it and fails closed, so an identity value copied in from
anywhere else cannot reach a commit. The two helper functions are duplicated in
both files on purpose: they must stay identical, and any drift makes
verification fail instead of passing silently.

The sanitizer intentionally preserves task/submission presentation history, but all task links and classroom links are unusable. User password hashes are replaced with an invalid marker; create or reset a local account through the supported development workflow after restore.

Re-export whenever a migration changes the shape the baseline must satisfy. The legacy attendance cutover is the reason step 6 exists: it drops the per-mark table, so a baseline captured before the conversion learned to carry recorder provenance can never satisfy the provenance guard again, and no later migration can repair it because the guard runs first. `verify-dev-baseline.sql` now fails on that condition while the dump can still be rebuilt.

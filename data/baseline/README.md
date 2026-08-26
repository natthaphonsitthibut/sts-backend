# Canonical development database baseline

`../backups/sts_backup.sql.gz` contains production-shaped presentation data after the current local migrations. It is not a raw production export.

Generation contract:

1. Use production only for read-only aggregate/schema evidence.
2. Clone the verified local target database to `sts_dev_baseline`. The sanitizer refuses any database whose name does not end in `baseline`, and the `baseline-export` compose profile dumps exactly this name.
3. Apply `sanitize-dev-baseline.sql` to revoke credentials and remove runtime/provider artifacts.
4. Run `verify-dev-baseline.sql` before dumping, and update `production-target-manifest.json` plus the migration count the verifier asserts.
5. Dump with PostgreSQL 15 using `pg_dump --clean --if-exists --no-owner --no-privileges`, gzip it, and restore it twice into a fresh PostgreSQL 15 data directory.
6. Restore the gzip into an empty database and run `pnpm migration:run`. It must report `No migrations are pending`.

The sanitizer intentionally preserves task/submission presentation history, but all task links and classroom links are unusable. User password hashes are replaced with an invalid marker; create or reset a local account through the supported development workflow after restore.

Re-export whenever a migration changes the shape the baseline must satisfy. The legacy attendance cutover is the reason step 6 exists: it drops the per-mark table, so a baseline captured before the conversion learned to carry recorder provenance can never satisfy the provenance guard again, and no later migration can repair it because the guard runs first. `verify-dev-baseline.sql` now fails on that condition while the dump can still be rebuilt.

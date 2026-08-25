# Canonical development database baseline

`../backups/sts_backup.sql.gz` contains production-shaped presentation data after the current local migrations. It is not a raw production export.

Generation contract:

1. Use production only for read-only aggregate/schema evidence.
2. Clone the verified local target database to a disposable database whose name ends in `baseline`.
3. Apply `sanitize-dev-baseline.sql` to revoke credentials and remove runtime/provider artifacts.
4. Run `verify-dev-baseline.sql` before dumping.
5. Dump with PostgreSQL 15 using `pg_dump --clean --if-exists --no-owner --no-privileges`, gzip it, and restore it twice into a fresh PostgreSQL 15 data directory.

The sanitizer intentionally preserves task/submission presentation history, but all task links and classroom links are unusable. User password hashes are replaced with an invalid marker; create or reset a local account through the supported development workflow after restore.

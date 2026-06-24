import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Phase B2.1 (EXPAND) — introduce a CANONICAL PERSON identity that is stable
 * across terms and schools, decoupled from the per-enrollment snapshot.
 *
 * Today `student_term.student_uuid` is the PK of a single enrollment row (B1.4),
 * so it is a *snapshot* id, not a *person* id. With multi-term data the same
 * human gets a new student_uuid every term, which would break account linkage
 * (users.person_uuid, later task). This adds:
 *   - `student_person`            — the durable person (identity only, thin)
 *   - `student_person_identifier` — audit trail of national-id/passport per person
 *   - `student_term.person_uuid`  — FK to the person who owns this enrollment
 *   - `student_dropouts.person_uuid`
 * and backfills 1 person per distinct national id, unified across term+dropouts.
 *
 * Naming: these are OUR canonical construct (not an ONEC mirror), so columns are
 * snake_case — the quoted PascalCase `_Onec` suffix is reserved for ONEC-sourced
 * payload fields only.
 *
 * Additive + reversible + idempotent. NON-destructive: PersonID_Onec stays the
 * UNIQUE reconciliation key and person_uuid is NULLABLE here. Promoting it to
 * NOT NULL and dropping the PersonID unique happens later in CONTRACT (B2.4),
 * which is gated on owner decisions (current-enrollment selection, duplicate
 * PersonID policy, enrollment natural key, dropout nullability).
 *
 * ⚠️ PRODUCTION-SCALE ROLLOUT (millions of rows): the steps below are written
 * set-based for the seed DB (~5k term / ~500 dropouts). For national data:
 *   1) keep person_uuid nullable (done) so ADD COLUMN does not rewrite the table
 *   2) backfill in batches (500–1000/chunk) instead of one statement; the ctid
 *      blank-row pass assumes no concurrent writes (true only inside a migration)
 *   3) build the FK with NOT VALID then VALIDATE CONSTRAINT, and create indexes
 *      with CREATE INDEX CONCURRENTLY in a separate non-transactional release
 */
export class AddCanonicalPersonIdentity20260624140000 implements MigrationInterface {
  name = 'AddCanonicalPersonIdentity20260624140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. canonical person (thin — name/address live in the enrollment snapshot)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_person (
        person_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        identity_status TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK (identity_status IN ('ACTIVE', 'NEEDS_REVIEW', 'MERGED')),
        merged_into UUID REFERENCES student_person(person_uuid) ON DELETE SET NULL,
        ${AUDIT_COLUMNS_SQL}
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_person'));

    // 2. national-id / passport audit trail (supports "PersonID corrected / duplicated").
    //    identifier_value = as-received, identifier_normalized = digits-only for matching.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_person_identifier (
        id BIGSERIAL PRIMARY KEY,
        person_uuid UUID NOT NULL REFERENCES student_person(person_uuid) ON DELETE CASCADE,
        identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NATIONAL_ID', 'PASSPORT')),
        identifier_value TEXT NOT NULL,
        identifier_normalized TEXT NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT TRUE,
        source TEXT,
        ${AUDIT_COLUMNS_SQL}
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_person_identifier'));
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_person_identifier_person
        ON student_person_identifier (person_uuid)
    `);
    // Non-unique on purpose: national IDs are NOT globally unique in real imports
    // (corrections, recycled/erroneous ids). Duplicates are flagged NEEDS_REVIEW
    // by the backfill below and by the import path, never hard-rejected here.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_person_identifier_normalized
        ON student_person_identifier (identifier_normalized, identifier_type)
    `);

    // 3. enrollment snapshot -> person FK (nullable now; NOT NULL in CONTRACT)
    for (const table of ['student_term', 'student_dropouts']) {
      const fk = `fk_${table}_person`;
      const idx = `idx_${table}_person_uuid`;
      await queryRunner.query(`
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS person_uuid UUID
      `);
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${fk}') THEN
            ALTER TABLE ${table}
              ADD CONSTRAINT ${fk} FOREIGN KEY (person_uuid)
              REFERENCES student_person(person_uuid) ON DELETE RESTRICT;
          END IF;
        END $$;
      `);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS ${idx} ON ${table} (person_uuid)
      `);
    }

    // 4. BACKFILL — one person per distinct non-blank normalized national id,
    //    unified across student_term + student_dropouts (a dropout who re-enrolls
    //    maps to the same person). Idempotent: only fills rows still NULL.

    // 4a. map normalized national id -> a fresh person_uuid, flagging ids whose
    //     source rows disagree on name (likely recycled/erroneous id = NEEDS_REVIEW).
    await queryRunner.query(`
      CREATE TEMP TABLE _b2_person_map ON COMMIT DROP AS
      WITH src AS (
        -- name_key is a whitespace-collapsed full name so the term (first+last)
        -- and dropout (single Fullname) shapes are comparable; it only drives the
        -- NEEDS_REVIEW heuristic (same id, different humans), never identity.
        SELECT
          REGEXP_REPLACE(COALESCE(TRIM("PersonID_Onec"), ''), '[^0-9]', '', 'g') AS nid,
          LOWER(REGEXP_REPLACE(
            TRIM(COALESCE("FirstName_Onec", '') || ' ' || COALESCE("LastName_Onec", '')),
            '\\s+', ' ', 'g')) AS name_key
        FROM student_term
        UNION ALL
        SELECT
          REGEXP_REPLACE(COALESCE(TRIM("PersonID_Onec"), ''), '[^0-9]', '', 'g') AS nid,
          LOWER(REGEXP_REPLACE(TRIM(COALESCE("Fullname_Onec", '')), '\\s+', ' ', 'g')) AS name_key
        FROM student_dropouts
      )
      SELECT
        nid,
        gen_random_uuid() AS person_uuid,
        (COUNT(DISTINCT NULLIF(name_key, '')) > 1) AS needs_review
      FROM src
      WHERE nid <> ''
        -- Idempotent / incremental: never re-mint a person for a national id that
        -- already has an identifier row (re-run safe; no orphan duplicates).
        AND nid NOT IN (
          SELECT identifier_normalized FROM student_person_identifier
          WHERE identifier_type = 'NATIONAL_ID'
        )
      GROUP BY nid
    `);

    await queryRunner.query(`
      INSERT INTO student_person (person_uuid, identity_status)
      SELECT person_uuid, CASE WHEN needs_review THEN 'NEEDS_REVIEW' ELSE 'ACTIVE' END
      FROM _b2_person_map
    `);

    await queryRunner.query(`
      INSERT INTO student_person_identifier
        (person_uuid, identifier_type, identifier_value, identifier_normalized, source)
      SELECT person_uuid, 'NATIONAL_ID', nid, nid, 'ONEC_BACKFILL'
      FROM _b2_person_map
    `);

    await queryRunner.query(`
      UPDATE student_term st SET person_uuid = m.person_uuid
      FROM _b2_person_map m
      WHERE st.person_uuid IS NULL
        AND REGEXP_REPLACE(COALESCE(TRIM(st."PersonID_Onec"), ''), '[^0-9]', '', 'g') = m.nid
    `);
    await queryRunner.query(`
      UPDATE student_dropouts sd SET person_uuid = m.person_uuid
      FROM _b2_person_map m
      WHERE sd.person_uuid IS NULL
        AND REGEXP_REPLACE(COALESCE(TRIM(sd."PersonID_Onec"), ''), '[^0-9]', '', 'g') = m.nid
    `);

    // 4b. blank / unusable national id -> a standalone person per row, flagged
    //     NEEDS_REVIEW. ctid is stable inside the migration transaction (no
    //     concurrent writes), so it is a safe per-row join key here.
    for (const table of ['student_term', 'student_dropouts']) {
      await queryRunner.query(`
        WITH blanks AS (
          SELECT ctid AS rid, gen_random_uuid() AS person_uuid
          FROM ${table}
          WHERE person_uuid IS NULL
        ),
        ins AS (
          INSERT INTO student_person (person_uuid, identity_status)
          SELECT person_uuid, 'NEEDS_REVIEW' FROM blanks
          RETURNING person_uuid
        )
        UPDATE ${table} t SET person_uuid = b.person_uuid
        FROM blanks b WHERE t.ctid = b.rid
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['student_dropouts', 'student_term']) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_person_uuid`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS fk_${table}_person`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS person_uuid`);
    }
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_student_person_identifier_set_updated_at ON student_person_identifier`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS student_person_identifier`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_student_person_set_updated_at ON student_person`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS student_person`);
  }
}

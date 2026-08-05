import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes a teacher's email address identify exactly one teacher.
 *
 * Why now: the LINE account-linking flow resolves a teacher from the email the
 * person types, then proves ownership with an emailed OTP. If two teachers can
 * share an address, that lookup is ambiguous and the OTP would prove nothing
 * about *which* teacher is on the other end — so the uniqueness has to be a
 * database guarantee, not a convention.
 *
 * Case-insensitive on purpose (`lower(btrim(email))`): mailbox providers treat
 * `A@x.th` and `a@x.th` as the same inbox, so a case-sensitive index would let
 * two rows claim one mailbox. Partial on `deleted_at IS NULL`, matching
 * `uq_teachers_citizen_id` — a soft-deleted row must not hold an address hostage.
 *
 * Inactive teachers are still covered: a retired teacher's mailbox belongs to
 * that person, and reassigning it to someone else silently would make the OTP
 * flow point at the wrong human.
 *
 * The membership trigger from `ResolveTeacherMembershipIdentity20260802170000`
 * copies `users.email` onto the teacher row it creates, and `users.email` is not
 * unique. Left alone, adding a teacher account to a school would start failing
 * with a raw unique violation from inside a trigger. It gets the same
 * "only copy if nobody else has it" guard the citizen id already has.
 */
export class AddTeacherEmailUniqueness20260804150000 implements MigrationInterface {
  name = 'AddTeacherEmailUniqueness20260804150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Automated-test fixtures deliberately reused one address across runs and
    //    would block the index. Only rows whose account is flagged AUTOMATED_TEST
    //    are touched, and only the later duplicates lose the address — real data
    //    is never rewritten to satisfy a constraint.
    await queryRunner.query(`
      UPDATE teachers
      SET email = NULL
      WHERE id IN (
        SELECT teacher.id
        FROM (
          SELECT
            teacher.id,
            row_number() OVER (
              PARTITION BY lower(btrim(teacher.email)) ORDER BY teacher.id
            ) AS duplicate_rank
          FROM teachers teacher
          JOIN users account ON account.id = teacher.linked_user_id
          WHERE teacher.deleted_at IS NULL
            AND teacher.email IS NOT NULL
            AND account.data_origin_code = 'AUTOMATED_TEST'
        ) teacher
        WHERE teacher.duplicate_rank > 1
      );
    `);

    // 2. Anything left is real data: two people's records claim one mailbox, and
    //    only a human knows which one owns it. Fail with the addresses named
    //    rather than picking a winner.
    const conflictResult: unknown = await queryRunner.query(`
      SELECT
        lower(btrim(email)) AS email,
        string_agg(id::text, ', ' ORDER BY id) AS teacher_ids
      FROM teachers
      WHERE deleted_at IS NULL AND email IS NOT NULL
      GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    `);
    const conflicts = (Array.isArray(conflictResult) ? conflictResult : []) as Array<{
      email: string;
      teacher_ids: string;
    }>;
    if (conflicts.length > 0) {
      const detail = conflicts
        .map((row) => `${row.email} (teachers ${row.teacher_ids})`)
        .join('; ');
      throw new Error(
        `Cannot make teacher emails unique: ${conflicts.length} address(es) are shared. ` +
          `Resolve them first, then re-run: ${detail}`,
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_teachers_email
        ON teachers (lower(btrim(email)))
        WHERE email IS NOT NULL AND deleted_at IS NULL;
    `);

    // 3. Same trigger as before with the email guard added.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION resolve_school_teacher_membership_identity()
      RETURNS trigger AS $$
      DECLARE
        source_user users%ROWTYPE;
      BEGIN
        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        IF NEW.teacher_user_id IS NULL THEN
          RAISE EXCEPTION 'teacher membership needs either teacher_id or teacher_user_id'
            USING ERRCODE = '23502';
        END IF;

        SELECT teacher.id
        INTO NEW.teacher_id
        FROM teachers teacher
        WHERE teacher.linked_user_id = NEW.teacher_user_id
          AND teacher.deleted_at IS NULL
        LIMIT 1;

        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT * INTO source_user FROM users WHERE id = NEW.teacher_user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'teacher account % does not exist', NEW.teacher_user_id
            USING ERRCODE = '23503';
        END IF;

        -- Same normalisation as the original backfill: copy only well-formed
        -- contact values so the teachers CHECK constraints always hold, and only
        -- values no other teacher already holds so the unique indexes hold too.
        INSERT INTO teachers (
          first_name,
          last_name,
          citizen_id,
          phone,
          email,
          line_id,
          teacher_status,
          linked_user_id
        )
        VALUES (
          COALESCE(NULLIF(btrim(source_user."FirstName"), ''), source_user.username),
          COALESCE(NULLIF(btrim(source_user."LastName"), ''), '-'),
          CASE
            WHEN btrim(COALESCE(source_user."PersonID_Onec", '')) ~ '^[0-9]{13}$'
              AND NOT EXISTS (
                SELECT 1 FROM teachers existing
                WHERE existing.citizen_id = btrim(source_user."PersonID_Onec")
                  AND existing.deleted_at IS NULL
              )
            THEN btrim(source_user."PersonID_Onec")
          END,
          CASE
            WHEN btrim(COALESCE(source_user.phone, '')) ~ '^[0-9]{9,10}$'
            THEN btrim(source_user.phone)
          END,
          CASE
            WHEN position('@' IN btrim(COALESCE(source_user.email, ''))) > 1
              AND NOT EXISTS (
                SELECT 1 FROM teachers existing
                WHERE lower(btrim(existing.email)) = lower(btrim(source_user.email))
                  AND existing.deleted_at IS NULL
              )
            THEN btrim(source_user.email)
          END,
          NULLIF(btrim(COALESCE(source_user.line_id, '')), ''),
          CASE WHEN source_user.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
          source_user.id
        )
        RETURNING id INTO NEW.teacher_id;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_teachers_email;`);

    // Restore the pre-guard trigger body from
    // ResolveTeacherMembershipIdentity20260802170000. Emails cleared in `up` are
    // not restored — the addresses were automated-test duplicates.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION resolve_school_teacher_membership_identity()
      RETURNS trigger AS $$
      DECLARE
        source_user users%ROWTYPE;
      BEGIN
        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        IF NEW.teacher_user_id IS NULL THEN
          RAISE EXCEPTION 'teacher membership needs either teacher_id or teacher_user_id'
            USING ERRCODE = '23502';
        END IF;

        SELECT teacher.id
        INTO NEW.teacher_id
        FROM teachers teacher
        WHERE teacher.linked_user_id = NEW.teacher_user_id
          AND teacher.deleted_at IS NULL
        LIMIT 1;

        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT * INTO source_user FROM users WHERE id = NEW.teacher_user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'teacher account % does not exist', NEW.teacher_user_id
            USING ERRCODE = '23503';
        END IF;

        INSERT INTO teachers (
          first_name,
          last_name,
          citizen_id,
          phone,
          email,
          line_id,
          teacher_status,
          linked_user_id
        )
        VALUES (
          COALESCE(NULLIF(btrim(source_user."FirstName"), ''), source_user.username),
          COALESCE(NULLIF(btrim(source_user."LastName"), ''), '-'),
          CASE
            WHEN btrim(COALESCE(source_user."PersonID_Onec", '')) ~ '^[0-9]{13}$'
              AND NOT EXISTS (
                SELECT 1 FROM teachers existing
                WHERE existing.citizen_id = btrim(source_user."PersonID_Onec")
                  AND existing.deleted_at IS NULL
              )
            THEN btrim(source_user."PersonID_Onec")
          END,
          CASE
            WHEN btrim(COALESCE(source_user.phone, '')) ~ '^[0-9]{9,10}$'
            THEN btrim(source_user.phone)
          END,
          CASE
            WHEN position('@' IN btrim(COALESCE(source_user.email, ''))) > 1
            THEN btrim(source_user.email)
          END,
          NULLIF(btrim(COALESCE(source_user.line_id, '')), ''),
          CASE WHEN source_user.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
          source_user.id
        )
        RETURNING id INTO NEW.teacher_id;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }
}

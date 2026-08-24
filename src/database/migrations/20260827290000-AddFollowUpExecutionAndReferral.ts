import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const AUDIT_COLUMNS = `
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
`;

const NEW_TABLES = [
  'task_execution_outcome_options',
  'non_follow_up_reason_options',
  'home_visit_disadvantage_observations',
  'home_visit_disability_observations',
  'referral_agency_kinds',
  'referral_agencies',
  'case_referrals',
] as const;

async function secureTables(queryRunner: QueryRunner): Promise<void> {
  for (const table of NEW_TABLES) {
    await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }
  await queryRunner.query(`
    DO $secure_follow_up_tables$
    DECLARE role_name TEXT;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE ${NEW_TABLES.join(', ')} FROM %I',
            role_name
          );
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON SEQUENCE referral_agencies_id_seq FROM %I',
            role_name
          );
        END IF;
      END LOOP;
    END
    $secure_follow_up_tables$
  `);
}

export class AddFollowUpExecutionAndReferral20260827290000 implements MigrationInterface {
  name = 'AddFollowUpExecutionAndReferral20260827290000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $follow_up_prerequisites$
      BEGIN
        IF to_regclass('public.disadvantage_types') IS NULL
           OR to_regclass('public.disability_types') IS NULL THEN
          RAISE EXCEPTION 'student-care master-data prerequisite is missing';
        END IF;
      END
      $follow_up_prerequisites$
    `);

    await queryRunner.query(`
      CREATE TABLE task_execution_outcome_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(200) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS},
        CONSTRAINT chk_task_execution_outcomes_code CHECK (btrim(code) <> ''),
        CONSTRAINT chk_task_execution_outcomes_label CHECK (btrim(label_th) <> ''),
        CONSTRAINT chk_task_execution_outcomes_sort CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('task_execution_outcome_options'));
    await queryRunner.query(`
      INSERT INTO task_execution_outcome_options (code, label_th, sort_order) VALUES
        ('SUCCEEDED', 'สำเร็จ', 10),
        ('NOT_SUCCEEDED', 'ยังไม่สำเร็จ', 20)
    `);

    await queryRunner.query(`
      CREATE TABLE non_follow_up_reason_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(200) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS},
        CONSTRAINT chk_non_follow_up_reasons_code CHECK (btrim(code) <> ''),
        CONSTRAINT chk_non_follow_up_reasons_label CHECK (btrim(label_th) <> ''),
        CONSTRAINT chk_non_follow_up_reasons_sort CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('non_follow_up_reason_options'));
    await queryRunner.query(`
      INSERT INTO non_follow_up_reason_options (code, label_th, sort_order) VALUES
        ('UNREACHABLE', 'ติดต่อไม่ได้', 10),
        ('MOVED_WITHOUT_NOTICE', 'ย้ายที่อยู่โดยไม่แจ้ง', 20),
        ('REFUSED_FOLLOW_UP', 'ปฏิเสธการติดตาม', 30),
        ('TRANSFERRED_SCHOOL', 'ย้ายสถานศึกษา', 40),
        ('STUDYING_ABROAD', 'เรียนต่อต่างประเทศ', 50)
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN task_execution_outcome_code VARCHAR(40),
        ADD COLUMN non_follow_up_reason_code VARCHAR(40)
    `);
    await queryRunner.query(`
      UPDATE task_submissions
      SET task_execution_outcome_code = CASE
        WHEN home_visit_exception_code = 'STUDENT_NOT_FOUND' THEN 'NOT_SUCCEEDED'
        ELSE 'SUCCEEDED'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ALTER COLUMN task_execution_outcome_code SET NOT NULL,
        ADD CONSTRAINT fk_task_submissions_execution_outcome
          FOREIGN KEY (task_execution_outcome_code)
          REFERENCES task_execution_outcome_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_task_submissions_non_follow_up_reason
          FOREIGN KEY (non_follow_up_reason_code)
          REFERENCES non_follow_up_reason_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_task_submissions_non_follow_up_reason CHECK (
          non_follow_up_reason_code IS NULL
          OR task_execution_outcome_code = 'NOT_SUCCEEDED'
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_submissions_execution_outcome_time
      ON task_submissions (task_execution_outcome_code, submitted_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_submissions_non_follow_up_reason
      ON task_submissions (non_follow_up_reason_code, submitted_at DESC)
      WHERE non_follow_up_reason_code IS NOT NULL
    `);

    for (const [table, codeColumn, targetTable, targetColumn] of [
      [
        'home_visit_disadvantage_observations',
        'disadvantage_type_code',
        'disadvantage_types',
        'disadvantage_type_code',
      ],
      [
        'home_visit_disability_observations',
        'disability_type_code',
        'disability_types',
        'disability_type_code',
      ],
    ] as const) {
      await queryRunner.query(`
        CREATE TABLE ${table} (
          task_submission_id INTEGER NOT NULL,
          ${codeColumn} VARCHAR(40) NOT NULL,
          verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
          observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ,
          reviewed_by_user_id INTEGER,
          review_note VARCHAR(1000),
          PRIMARY KEY (task_submission_id, ${codeColumn}),
          CONSTRAINT fk_${table}_submission FOREIGN KEY (task_submission_id)
            REFERENCES task_submissions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
          CONSTRAINT fk_${table}_type FOREIGN KEY (${codeColumn})
            REFERENCES ${targetTable}(code) ON DELETE RESTRICT ON UPDATE CASCADE,
          CONSTRAINT fk_${table}_reviewer FOREIGN KEY (reviewed_by_user_id)
            REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
          CONSTRAINT chk_${table}_status CHECK (
            verification_status IN ('PENDING', 'APPROVED', 'REJECTED')
          ),
          CONSTRAINT chk_${table}_review_state CHECK (
            (verification_status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
            OR (verification_status IN ('APPROVED', 'REJECTED') AND reviewed_at IS NOT NULL)
          ),
          CONSTRAINT chk_${table}_note CHECK (
            review_note IS NULL OR length(btrim(review_note)) BETWEEN 1 AND 1000
          )
        )
      `);
      await queryRunner.query(`
        CREATE INDEX idx_${table}_status_time
        ON ${table} (verification_status, observed_at DESC)
      `);
      await queryRunner.query(`
        CREATE INDEX idx_${table}_type_status
        ON ${table} (${targetColumn}, verification_status)
      `);
      await queryRunner.query(`
        CREATE INDEX idx_${table}_reviewer
        ON ${table} (reviewed_by_user_id)
        WHERE reviewed_by_user_id IS NOT NULL
      `);
    }

    await queryRunner.query(`
      CREATE TABLE referral_agency_kinds (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(200) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS},
        CONSTRAINT chk_referral_agency_kinds_code CHECK (btrim(code) <> ''),
        CONSTRAINT chk_referral_agency_kinds_label CHECK (btrim(label_th) <> ''),
        CONSTRAINT chk_referral_agency_kinds_sort CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('referral_agency_kinds'));
    await queryRunner.query(`
      INSERT INTO referral_agency_kinds (code, label_th, sort_order) VALUES
        ('OTHER_SCHOOL', 'สถานศึกษาอื่น', 10),
        ('LEARNING_PROMOTION', 'หน่วยงานส่งเสริมการเรียนรู้', 20),
        ('PUBLIC_HOSPITAL', 'โรงพยาบาลรัฐบาล', 30),
        ('POLICE', 'ตำรวจ / สถานีตำรวจ', 40),
        ('CHILD_FOUNDATION', 'มูลนิธิช่วยเหลือเด็ก', 50),
        ('OTHER', 'หน่วยงานประเภทอื่น', 90)
    `);

    await queryRunner.query(`
      CREATE TABLE referral_agencies (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        agency_name VARCHAR(250) NOT NULL,
        agency_kind_code VARCHAR(40) NOT NULL,
        contact_phone VARCHAR(30),
        contact_email VARCHAR(254),
        website_url VARCHAR(500),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS},
        CONSTRAINT fk_referral_agencies_kind FOREIGN KEY (agency_kind_code)
          REFERENCES referral_agency_kinds(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_referral_agencies_name CHECK (btrim(agency_name) <> ''),
        CONSTRAINT chk_referral_agencies_phone CHECK (
          contact_phone IS NULL OR btrim(contact_phone) <> ''
        ),
        CONSTRAINT chk_referral_agencies_email CHECK (
          contact_email IS NULL OR btrim(contact_email) <> ''
        ),
        CONSTRAINT chk_referral_agencies_website CHECK (
          website_url IS NULL OR btrim(website_url) <> ''
        )
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('referral_agencies'));
    await queryRunner.query(`
      CREATE INDEX idx_referral_agencies_kind_active_name
      ON referral_agencies (agency_kind_code, is_active, agency_name)
    `);

    await queryRunner.query(`
      ALTER TABLE case_reviews
        ADD CONSTRAINT uq_case_reviews_id_case UNIQUE (id, case_id)
    `);

    await queryRunner.query(`
      CREATE TABLE case_referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_review_id UUID NOT NULL UNIQUE,
        case_id INTEGER NOT NULL,
        referral_agency_id BIGINT NOT NULL,
        status_code VARCHAR(20) NOT NULL DEFAULT 'REFERRED',
        referred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        referred_by_user_id INTEGER,
        referral_note VARCHAR(2000),
        ${AUDIT_COLUMNS},
        CONSTRAINT fk_case_referrals_review_case FOREIGN KEY (case_review_id, case_id)
          REFERENCES case_reviews(id, case_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_case_referrals_case FOREIGN KEY (case_id)
          REFERENCES cases(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_case_referrals_agency FOREIGN KEY (referral_agency_id)
          REFERENCES referral_agencies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_case_referrals_referrer FOREIGN KEY (referred_by_user_id)
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_case_referrals_status CHECK (
          status_code IN ('REFERRED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED')
        ),
        CONSTRAINT chk_case_referrals_note CHECK (
          referral_note IS NULL OR length(btrim(referral_note)) BETWEEN 1 AND 2000
        )
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referrals'));
    await queryRunner.query(`
      CREATE INDEX idx_case_referrals_case_time
      ON case_referrals (case_id, referred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referrals_agency_time
      ON case_referrals (referral_agency_id, referred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referrals_status_time
      ON case_referrals (status_code, referred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referrals_referrer
      ON case_referrals (referred_by_user_id)
      WHERE referred_by_user_id IS NOT NULL
    `);

    await secureTables(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $follow_up_rollback_guard$
      BEGIN
        IF EXISTS (SELECT 1 FROM case_referrals)
           OR EXISTS (SELECT 1 FROM home_visit_disadvantage_observations)
           OR EXISTS (SELECT 1 FROM home_visit_disability_observations)
           OR EXISTS (
             SELECT 1 FROM task_submissions WHERE non_follow_up_reason_code IS NOT NULL
           ) THEN
          RAISE EXCEPTION 'refusing rollback: follow-up records use the new contract';
        END IF;
      END
      $follow_up_rollback_guard$
    `);

    await queryRunner.query(`DROP TABLE case_referrals`);
    await queryRunner.query(`
      ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS uq_case_reviews_id_case
    `);
    await queryRunner.query(`DROP TABLE referral_agencies`);
    await queryRunner.query(`DROP TABLE referral_agency_kinds`);
    await queryRunner.query(`DROP TABLE home_visit_disability_observations`);
    await queryRunner.query(`DROP TABLE home_visit_disadvantage_observations`);
    await queryRunner.query(`DROP INDEX idx_task_submissions_non_follow_up_reason`);
    await queryRunner.query(`DROP INDEX idx_task_submissions_execution_outcome_time`);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT chk_task_submissions_non_follow_up_reason,
        DROP CONSTRAINT fk_task_submissions_non_follow_up_reason,
        DROP CONSTRAINT fk_task_submissions_execution_outcome,
        DROP COLUMN non_follow_up_reason_code,
        DROP COLUMN task_execution_outcome_code
    `);
    await queryRunner.query(`DROP TABLE non_follow_up_reason_options`);
    await queryRunner.query(`DROP TABLE task_execution_outcome_options`);
  }
}

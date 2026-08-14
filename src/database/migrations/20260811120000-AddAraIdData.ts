import type { MigrationInterface, QueryRunner } from 'typeorm';

const CREATE_ARAID_TABLES_SQL = `
  CREATE TABLE araid_identity_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_number CHAR(13) NOT NULL,
    title_th VARCHAR(32),
    given_name_th VARCHAR(100) NOT NULL,
    family_name_th VARCHAR(100) NOT NULL,
    given_name_en VARCHAR(100),
    family_name_en VARCHAR(100),
    date_of_birth DATE,
    gender_code VARCHAR(16),
    phone_number VARCHAR(20),
    email_address VARCHAR(254),
    address_line VARCHAR(255),
    sub_district_name VARCHAR(100),
    district_name VARCHAR(100),
    province_name VARCHAR(100),
    postal_code CHAR(5),
    record_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id INTEGER NOT NULL,
    updated_by_user_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_araid_identity_records_number UNIQUE (identity_number),
    CONSTRAINT fk_araid_identity_records_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_araid_identity_records_updated_by
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_araid_identity_records_number
      CHECK (identity_number ~ '^[0-9]{13}$'),
    CONSTRAINT chk_araid_identity_records_names
      CHECK (btrim(given_name_th) <> '' AND btrim(family_name_th) <> ''),
    CONSTRAINT chk_araid_identity_records_gender
      CHECK (gender_code IS NULL OR gender_code IN ('MALE', 'FEMALE', 'OTHER')),
    CONSTRAINT chk_araid_identity_records_postal_code
      CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$'),
    CONSTRAINT chk_araid_identity_records_status
      CHECK (record_status IN ('ACTIVE', 'INACTIVE'))
  );
  CREATE INDEX idx_araid_identity_records_name
    ON araid_identity_records (given_name_th, family_name_th);
  CREATE INDEX idx_araid_identity_records_status_updated
    ON araid_identity_records (record_status, updated_at DESC);

  CREATE TABLE araid_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_record_id UUID NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    pin_hash VARCHAR(255) NOT NULL,
    registration_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    registration_method VARCHAR(24) NOT NULL DEFAULT 'MANAGED',
    failed_pin_attempts SMALLINT NOT NULL DEFAULT 0,
    pin_locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_araid_profiles_identity_record UNIQUE (identity_record_id),
    CONSTRAINT fk_araid_profiles_identity_record
      FOREIGN KEY (identity_record_id) REFERENCES araid_identity_records(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_araid_profiles_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_araid_profiles_status
      CHECK (registration_status IN ('ACTIVE', 'LOCKED', 'REVOKED')),
    CONSTRAINT chk_araid_profiles_method
      CHECK (registration_method = 'MANAGED'),
    CONSTRAINT chk_araid_profiles_failed_pin_attempts
      CHECK (failed_pin_attempts BETWEEN 0 AND 5),
    CONSTRAINT chk_araid_profiles_lock_state
      CHECK (
        (registration_status = 'LOCKED' AND pin_locked_until IS NOT NULL)
        OR (registration_status <> 'LOCKED' AND pin_locked_until IS NULL)
      )
  );
  CREATE INDEX idx_araid_profiles_status
    ON araid_profiles (registration_status);
`;

export class AddAraIdData20260811120000 implements MigrationInterface {
  name = 'AddAraIdData20260811120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(CREATE_ARAID_TABLES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE araid_profiles');
    await queryRunner.query('DROP TABLE araid_identity_records');
  }
}

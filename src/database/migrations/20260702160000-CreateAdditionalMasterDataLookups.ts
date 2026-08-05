import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const LOOKUP_TABLES = [
  'absence_reasons',
  'absence_reason_categories',
  'non_follow_up_reasons',
  'disability_types',
  'school_affiliations',
] as const;

function createLookupTableSql(tableName: string, extraColumns = ''): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      note TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      ${extraColumns}
      ${AUDIT_COLUMNS_SQL},
      CONSTRAINT chk_${tableName}_code CHECK (length(trim(code)) > 0),
      CONSTRAINT chk_${tableName}_name CHECK (length(trim(name)) > 0)
    )
  `;
}

/**
 * EXPAND — additional editable master-data lookup tables.
 *
 * `student_status` already exists as the canonical enrollment-status lookup, so
 * this migration only adds the remaining P1 lookup tables. No existing domain
 * tables are wired to these lookups yet; FK wiring happens in later P2 slices.
 */
export class CreateAdditionalMasterDataLookups20260702160000 implements MigrationInterface {
  name = 'CreateAdditionalMasterDataLookups20260702160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(createLookupTableSql('school_affiliations'));
    await queryRunner.query(
      createLookupTableSql('disability_types', 'legal_category TEXT,\n      '),
    );
    await queryRunner.query(createLookupTableSql('absence_reason_categories'));
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS absence_reasons (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category_id BIGINT NOT NULL REFERENCES absence_reason_categories(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        note TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_absence_reasons_code CHECK (length(trim(code)) > 0),
        CONSTRAINT chk_absence_reasons_name CHECK (length(trim(name)) > 0)
      )
    `);
    await queryRunner.query(createLookupTableSql('non_follow_up_reasons'));

    for (const table of LOOKUP_TABLES) {
      await queryRunner.query(auditUpdatedAtTriggerSql(table));
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_absence_reasons_category_id
        ON absence_reasons (category_id)
    `);

    await queryRunner.query(`
      INSERT INTO school_affiliations (code, name)
      VALUES
        ('สพฐ', 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน'),
        ('สช', 'สำนักงานคณะกรรมการส่งเสริมการศึกษาเอกชน'),
        ('อปท', 'องค์กรปกครองส่วนท้องถิ่น'),
        ('กทม', 'กรุงเทพมหานคร'),
        ('มกท', 'เมืองพัทยา')
      ON CONFLICT (code) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO disability_types (code, name, legal_category)
      VALUES
        ('NONE', 'ไม่มีความพิการ', NULL),
        ('VISUAL', 'ความบกพร่องทางการเห็น', 'ความพิการทางการเห็น'),
        ('HEARING', 'ความบกพร่องทางการได้ยินหรือสื่อความหมาย', 'ความพิการทางการได้ยินหรือสื่อความหมาย'),
        ('INTELLECTUAL', 'ความบกพร่องทางสติปัญญา', 'ความพิการทางสติปัญญา'),
        ('PHYSICAL_HEALTH', 'ความบกพร่องทางร่างกายหรือสุขภาพ', 'ความพิการทางร่างกายหรือการเคลื่อนไหว'),
        ('LEARNING', 'ความบกพร่องทางการเรียนรู้', 'ความพิการทางการเรียนรู้'),
        ('SPEECH_LANGUAGE', 'ความบกพร่องทางการพูดและภาษา', 'ความพิการทางการพูดและภาษา'),
        ('BEHAVIOR_EMOTION', 'ความบกพร่องทางพฤติกรรมหรืออารมณ์', 'ความพิการทางพฤติกรรมหรืออารมณ์'),
        ('AUTISM', 'ออทิสติก', 'ออทิสติก'),
        ('MULTIPLE', 'ความพิการซ้อน', 'ความพิการซ้อน')
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_absence_reasons_category_id`);
    for (const table of LOOKUP_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${table}_set_updated_at ON ${table}`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS absence_reasons`);
    await queryRunner.query(`DROP TABLE IF EXISTS absence_reason_categories`);
    await queryRunner.query(`DROP TABLE IF EXISTS non_follow_up_reasons`);
    await queryRunner.query(`DROP TABLE IF EXISTS disability_types`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_affiliations`);
  }
}

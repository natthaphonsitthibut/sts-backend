import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Standardize the early subject-code seed values to the TH101-style convention
 * shown in the create-subject form placeholder. Foreign keys reference
 * subjects.id, so this only changes the display/reference code.
 */
export class StandardizeSubjectCodes20260711140000 implements MigrationInterface {
  name = 'StandardizeSubjectCodes20260711140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM (VALUES
            ('THAI', 'TH101'),
            ('MATH', 'MATH101'),
            ('SCI', 'SCI101'),
            ('ENG', 'ENG101'),
            ('SOC', 'SOC101'),
            ('PE', 'PE101'),
            ('ART', 'ART101'),
            ('CAREER', 'CAREER101')
          ) AS mapping(old_code, new_code)
          JOIN subjects target ON target.code = mapping.new_code
          WHERE NOT EXISTS (
            SELECT 1
            FROM subjects source
            WHERE source.code = mapping.old_code
              AND source.id = target.id
          )
        ) THEN
          RAISE EXCEPTION 'Cannot standardize subject codes because one or more target codes already exist';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE subjects AS s
      SET code = mapping.new_code,
          updated_at = now()
      FROM (VALUES
        ('THAI', 'TH101'),
        ('MATH', 'MATH101'),
        ('SCI', 'SCI101'),
        ('ENG', 'ENG101'),
        ('SOC', 'SOC101'),
        ('PE', 'PE101'),
        ('ART', 'ART101'),
        ('CAREER', 'CAREER101')
      ) AS mapping(old_code, new_code)
      WHERE s.code = mapping.old_code
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM (VALUES
            ('TH101', 'THAI'),
            ('MATH101', 'MATH'),
            ('SCI101', 'SCI'),
            ('ENG101', 'ENG'),
            ('SOC101', 'SOC'),
            ('PE101', 'PE'),
            ('ART101', 'ART'),
            ('CAREER101', 'CAREER')
          ) AS mapping(current_code, previous_code)
          JOIN subjects target ON target.code = mapping.previous_code
          WHERE NOT EXISTS (
            SELECT 1
            FROM subjects source
            WHERE source.code = mapping.current_code
              AND source.id = target.id
          )
        ) THEN
          RAISE EXCEPTION 'Cannot revert subject codes because one or more previous codes already exist';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE subjects AS s
      SET code = mapping.previous_code,
          updated_at = now()
      FROM (VALUES
        ('TH101', 'THAI'),
        ('MATH101', 'MATH'),
        ('SCI101', 'SCI'),
        ('ENG101', 'ENG'),
        ('SOC101', 'SOC'),
        ('PE101', 'PE'),
        ('ART101', 'ART'),
        ('CAREER101', 'CAREER')
      ) AS mapping(current_code, previous_code)
      WHERE s.code = mapping.current_code
    `);
  }
}

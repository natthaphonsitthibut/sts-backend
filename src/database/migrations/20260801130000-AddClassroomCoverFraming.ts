import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassroomCoverFraming20260801130000 implements MigrationInterface {
  name = 'AddClassroomCoverFraming20260801130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        DROP CONSTRAINT chk_school_classrooms_card_cover_color
    `);
    await queryRunner.query(`
      UPDATE school_classrooms
      SET card_cover_color = CASE card_cover_color
        WHEN 'BLUE' THEN '#4F86E8'
        WHEN 'GREEN' THEN '#34B889'
        WHEN 'ORANGE' THEN '#FF7A45'
        WHEN 'PURPLE' THEN '#8B6EDB'
        WHEN 'SLATE' THEN '#64748B'
        ELSE '#4F86E8'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        ALTER COLUMN card_cover_color TYPE VARCHAR(7),
        ALTER COLUMN card_cover_color SET DEFAULT '#4F86E8',
        ADD COLUMN cover_image_position_x SMALLINT NOT NULL DEFAULT 50,
        ADD COLUMN cover_image_position_y SMALLINT NOT NULL DEFAULT 50,
        ADD COLUMN cover_image_scale NUMERIC(4,2) NOT NULL DEFAULT 1.00,
        ADD CONSTRAINT chk_school_classrooms_card_cover_color
          CHECK (card_cover_color ~ '^#[0-9A-F]{6}$'),
        ADD CONSTRAINT chk_school_classrooms_cover_image_position_x
          CHECK (cover_image_position_x BETWEEN 0 AND 100),
        ADD CONSTRAINT chk_school_classrooms_cover_image_position_y
          CHECK (cover_image_position_y BETWEEN 0 AND 100),
        ADD CONSTRAINT chk_school_classrooms_cover_image_scale
          CHECK (cover_image_scale BETWEEN 1.00 AND 3.00)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        DROP CONSTRAINT chk_school_classrooms_card_cover_color
    `);
    await queryRunner.query(`
      UPDATE school_classrooms
      SET card_cover_color = CASE card_cover_color
        WHEN '#34B889' THEN 'GREEN'
        WHEN '#FF7A45' THEN 'ORANGE'
        WHEN '#8B6EDB' THEN 'PURPLE'
        WHEN '#64748B' THEN 'SLATE'
        ELSE 'BLUE'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        DROP CONSTRAINT chk_school_classrooms_cover_image_position_x,
        DROP CONSTRAINT chk_school_classrooms_cover_image_position_y,
        DROP CONSTRAINT chk_school_classrooms_cover_image_scale,
        DROP COLUMN cover_image_position_x,
        DROP COLUMN cover_image_position_y,
        DROP COLUMN cover_image_scale,
        ALTER COLUMN card_cover_color TYPE VARCHAR(16),
        ALTER COLUMN card_cover_color SET DEFAULT 'BLUE',
        ADD CONSTRAINT chk_school_classrooms_card_cover_color
          CHECK (card_cover_color IN ('BLUE', 'GREEN', 'ORANGE', 'PURPLE', 'SLATE'))
    `);
  }
}

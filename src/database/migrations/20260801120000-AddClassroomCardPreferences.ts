import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassroomCardPreferences20260801120000 implements MigrationInterface {
  name = 'AddClassroomCardPreferences20260801120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        ADD COLUMN card_cover_color VARCHAR(16) NOT NULL DEFAULT 'BLUE',
        ADD COLUMN cover_image_storage_key VARCHAR(255) NULL,
        ADD CONSTRAINT chk_school_classrooms_card_cover_color
          CHECK (card_cover_color IN ('BLUE', 'GREEN', 'ORANGE', 'PURPLE', 'SLATE'))
    `);

    await queryRunner.query(`
      CREATE TABLE user_classroom_favorites (
        user_id INTEGER NOT NULL,
        classroom_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_user_classroom_favorites PRIMARY KEY (user_id, classroom_id),
        CONSTRAINT fk_user_classroom_favorites_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_user_classroom_favorites_classroom
          FOREIGN KEY (classroom_id) REFERENCES school_classrooms(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_user_classroom_favorites_order
        ON user_classroom_favorites (user_id, created_at DESC, classroom_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE user_classroom_favorites`);
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        DROP CONSTRAINT chk_school_classrooms_card_cover_color,
        DROP COLUMN cover_image_storage_key,
        DROP COLUMN card_cover_color
    `);
  }
}

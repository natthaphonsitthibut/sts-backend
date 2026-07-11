import type { MigrationInterface, QueryRunner } from 'typeorm';

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const BACKUP_TABLE = 'schema_id_uuid_standardization_backup';

export class StandardizeTaskIdsToUuid20260711120000 implements MigrationInterface {
  name = 'StandardizeTaskIdsToUuid20260711120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createBackupTable(queryRunner);
    await this.backupIdMap(queryRunner, 'tasks');
    await this.backupIdMap(queryRunner, 'task_links');
    await this.backupIdMap(queryRunner, 'case_reviews');

    await this.dropUuidTargetForeignKeys(queryRunner);

    await queryRunner.query(`
      UPDATE task_links target
      SET task_id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'tasks'
        AND target.task_id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE task_links target
      SET parent_link_id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.parent_link_id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE task_submissions target
      SET task_link_id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.task_link_id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE visit_work_sessions target
      SET task_link_id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.task_link_id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE task_link_timetable_slots target
      SET task_link_id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.task_link_id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE student_risk_profiles target
      SET latest_open_task_id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'tasks'
        AND target.latest_open_task_id = backup.old_text_id
    `);

    await queryRunner.query(`
      UPDATE tasks target
      SET id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'tasks'
        AND target.id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE task_links target
      SET id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.id = backup.old_text_id
    `);
    await queryRunner.query(`
      UPDATE case_reviews target
      SET id = backup.new_uuid::text
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'case_reviews'
        AND target.id = backup.old_text_id
    `);

    await queryRunner.query(`ALTER TABLE tasks ALTER COLUMN id TYPE UUID USING id::uuid`);
    await queryRunner.query(`ALTER TABLE task_links ALTER COLUMN id TYPE UUID USING id::uuid`);
    await queryRunner.query(`ALTER TABLE case_reviews ALTER COLUMN id TYPE UUID USING id::uuid`);

    await queryRunner.query(
      `ALTER TABLE task_links ALTER COLUMN task_id TYPE UUID USING task_id::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links ALTER COLUMN parent_link_id TYPE UUID USING parent_link_id::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE task_submissions ALTER COLUMN task_link_id TYPE UUID USING task_link_id::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE visit_work_sessions ALTER COLUMN task_link_id TYPE UUID USING task_link_id::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE task_link_timetable_slots ALTER COLUMN task_link_id TYPE UUID USING task_link_id::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE student_risk_profiles ALTER COLUMN latest_open_task_id TYPE UUID USING latest_open_task_id::uuid`,
    );

    await queryRunner.query(`ALTER TABLE tasks ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
    await queryRunner.query(`ALTER TABLE task_links ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
    await queryRunner.query(
      `ALTER TABLE case_reviews ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    );

    await this.addUuidTargetForeignKeys(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropUuidTargetForeignKeys(queryRunner);

    await queryRunner.query(`ALTER TABLE tasks ALTER COLUMN id DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE task_links ALTER COLUMN id DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE case_reviews ALTER COLUMN id DROP DEFAULT`);

    await queryRunner.query(`ALTER TABLE tasks ALTER COLUMN id TYPE TEXT USING id::text`);
    await queryRunner.query(`ALTER TABLE task_links ALTER COLUMN id TYPE TEXT USING id::text`);
    await queryRunner.query(`ALTER TABLE case_reviews ALTER COLUMN id TYPE TEXT USING id::text`);

    await queryRunner.query(
      `ALTER TABLE task_links ALTER COLUMN task_id TYPE TEXT USING task_id::text`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links ALTER COLUMN parent_link_id TYPE TEXT USING parent_link_id::text`,
    );
    await queryRunner.query(
      `ALTER TABLE task_submissions ALTER COLUMN task_link_id TYPE TEXT USING task_link_id::text`,
    );
    await queryRunner.query(
      `ALTER TABLE visit_work_sessions ALTER COLUMN task_link_id TYPE TEXT USING task_link_id::text`,
    );
    await queryRunner.query(
      `ALTER TABLE task_link_timetable_slots ALTER COLUMN task_link_id TYPE TEXT USING task_link_id::text`,
    );
    await queryRunner.query(
      `ALTER TABLE student_risk_profiles ALTER COLUMN latest_open_task_id TYPE TEXT USING latest_open_task_id::text`,
    );

    await queryRunner.query(`
      UPDATE task_links target
      SET task_id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'tasks'
        AND target.task_id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE task_links target
      SET parent_link_id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.parent_link_id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE task_submissions target
      SET task_link_id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.task_link_id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE visit_work_sessions target
      SET task_link_id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.task_link_id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE task_link_timetable_slots target
      SET task_link_id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.task_link_id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE student_risk_profiles target
      SET latest_open_task_id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'tasks'
        AND target.latest_open_task_id = backup.new_uuid::text
    `);

    await queryRunner.query(`
      UPDATE tasks target
      SET id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'tasks'
        AND target.id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE task_links target
      SET id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'task_links'
        AND target.id = backup.new_uuid::text
    `);
    await queryRunner.query(`
      UPDATE case_reviews target
      SET id = backup.old_text_id
      FROM ${BACKUP_TABLE} backup
      WHERE backup.source_table = 'case_reviews'
        AND target.id = backup.new_uuid::text
    `);

    await this.addTextTargetForeignKeys(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  }

  private async createBackupTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        source_table VARCHAR(40) NOT NULL,
        old_text_id TEXT NOT NULL,
        new_uuid UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_schema_id_uuid_standardization_backup
          PRIMARY KEY (source_table, old_text_id),
        CONSTRAINT uq_schema_id_uuid_standardization_backup_new_uuid
          UNIQUE (source_table, new_uuid)
      )
    `);
  }

  private async backupIdMap(queryRunner: QueryRunner, tableName: string): Promise<void> {
    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (source_table, old_text_id, new_uuid)
      SELECT
        '${tableName}',
        id,
        CASE
          WHEN id ~ '${UUID_PATTERN}' THEN id::uuid
          ELSE (
            substr(md5('sts:${tableName}:' || id), 1, 8) || '-' ||
            substr(md5('sts:${tableName}:' || id), 9, 4) || '-' ||
            '5' || substr(md5('sts:${tableName}:' || id), 14, 3) || '-' ||
            '8' || substr(md5('sts:${tableName}:' || id), 18, 3) || '-' ||
            substr(md5('sts:${tableName}:' || id), 21, 12)
          )::uuid
        END
      FROM ${tableName}
      ON CONFLICT (source_table, old_text_id) DO NOTHING
    `);
  }

  private async dropUuidTargetForeignKeys(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE task_links DROP CONSTRAINT IF EXISTS task_links_task_id_fkey`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links DROP CONSTRAINT IF EXISTS task_links_parent_link_id_fkey`,
    );
    await queryRunner.query(
      `ALTER TABLE task_submissions DROP CONSTRAINT IF EXISTS task_submissions_task_link_id_fkey`,
    );
    await queryRunner.query(
      `ALTER TABLE visit_work_sessions DROP CONSTRAINT IF EXISTS fk_visit_work_sessions_task_link`,
    );
    await queryRunner.query(
      `ALTER TABLE task_link_timetable_slots DROP CONSTRAINT IF EXISTS fk_task_link_timetable_slots_task_link`,
    );
    await queryRunner.query(
      `ALTER TABLE student_risk_profiles DROP CONSTRAINT IF EXISTS fk_student_risk_profiles_latest_task`,
    );
  }

  private async addUuidTargetForeignKeys(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
      ADD CONSTRAINT task_links_task_id_fkey
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
      ADD CONSTRAINT task_links_parent_link_id_fkey
      FOREIGN KEY (parent_link_id) REFERENCES task_links(id)
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
      ADD CONSTRAINT task_submissions_task_link_id_fkey
      FOREIGN KEY (task_link_id) REFERENCES task_links(id)
    `);
    await queryRunner.query(`
      ALTER TABLE visit_work_sessions
      ADD CONSTRAINT fk_visit_work_sessions_task_link
      FOREIGN KEY (task_link_id) REFERENCES task_links(id) ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_link_timetable_slots
      ADD CONSTRAINT fk_task_link_timetable_slots_task_link
      FOREIGN KEY (task_link_id) REFERENCES task_links(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
      ADD CONSTRAINT fk_student_risk_profiles_latest_task
      FOREIGN KEY (latest_open_task_id) REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }

  private async addTextTargetForeignKeys(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
      ADD CONSTRAINT task_links_task_id_fkey
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
      ADD CONSTRAINT task_links_parent_link_id_fkey
      FOREIGN KEY (parent_link_id) REFERENCES task_links(id)
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
      ADD CONSTRAINT task_submissions_task_link_id_fkey
      FOREIGN KEY (task_link_id) REFERENCES task_links(id)
    `);
    await queryRunner.query(`
      ALTER TABLE visit_work_sessions
      ADD CONSTRAINT fk_visit_work_sessions_task_link
      FOREIGN KEY (task_link_id) REFERENCES task_links(id) ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_link_timetable_slots
      ADD CONSTRAINT fk_task_link_timetable_slots_task_link
      FOREIGN KEY (task_link_id) REFERENCES task_links(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
      ADD CONSTRAINT fk_student_risk_profiles_latest_task
      FOREIGN KEY (latest_open_task_id) REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }
}

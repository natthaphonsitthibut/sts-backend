import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Students land on their own data page and must not access the staff dashboard. */
export class RevokeStudentHomePermission20260719130000 implements MigrationInterface {
  name = 'RevokeStudentHomePermission20260719130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_home_permission_migration_backups (
        id BIGSERIAL PRIMARY KEY,
        role_name VARCHAR(64),
        user_id INTEGER,
        original_permissions JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_student_home_permission_backup_role
          FOREIGN KEY (role_name) REFERENCES roles(name)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_student_home_permission_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_student_home_permission_backup_owner
          CHECK ((role_name IS NULL) <> (user_id IS NULL)),
        CONSTRAINT chk_student_home_permission_backup_json
          CHECK (jsonb_typeof(original_permissions) = 'array'),
        CONSTRAINT uq_student_home_permission_backup_role UNIQUE (role_name),
        CONSTRAINT uq_student_home_permission_backup_user UNIQUE (user_id)
      );

      INSERT INTO student_home_permission_migration_backups (role_name, original_permissions)
      SELECT name, COALESCE(default_permissions, '[]'::jsonb)
      FROM roles
      WHERE name = 'STUDENT';

      INSERT INTO student_home_permission_migration_backups (user_id, original_permissions)
      SELECT id, COALESCE(permissions, '[]'::jsonb)
      FROM users
      WHERE role = 'STUDENT';
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = (
        SELECT COALESCE(jsonb_agg(permission ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements_text(default_permissions) WITH ORDINALITY value(permission, ord)
        WHERE permission <> 'home'
      )
      WHERE name = 'STUDENT'
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = (
        SELECT COALESCE(jsonb_agg(permission ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements_text(COALESCE(users.permissions, '[]'::jsonb))
          WITH ORDINALITY value(permission, ord)
        WHERE permission <> 'home'
      )
      WHERE role = 'STUDENT'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles role_record
      SET default_permissions = backup.original_permissions
      FROM student_home_permission_migration_backups backup
      WHERE backup.role_name = role_record.name;

      UPDATE users user_record
      SET permissions = backup.original_permissions
      FROM student_home_permission_migration_backups backup
      WHERE backup.user_id = user_record.id;

      DROP TABLE student_home_permission_migration_backups;
    `);
  }
}

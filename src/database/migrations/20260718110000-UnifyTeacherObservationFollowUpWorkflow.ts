import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const BADGE_VARIANTS = "'default', 'secondary', 'destructive', 'success', 'warning'";

export class UnifyTeacherObservationFollowUpWorkflow20260718110000 implements MigrationInterface {
  name = 'UnifyTeacherObservationFollowUpWorkflow20260718110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_follow_up_request_statuses (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_follow_up_statuses_label
          CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_student_follow_up_statuses_badge
          CHECK (badge_variant IN (${BADGE_VARIANTS})),
        CONSTRAINT chk_student_follow_up_statuses_sort_order
          CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_follow_up_request_statuses'));
    await queryRunner.query(`
      INSERT INTO student_follow_up_request_statuses (
        code, label_th, badge_variant, sort_order, is_terminal, is_active
      ) VALUES
        ('PENDING_REVIEW', 'รอพิจารณา', 'warning', 10, FALSE, TRUE),
        ('APPROVED', 'เปิดเคสแล้ว', 'success', 20, TRUE, TRUE),
        ('REJECTED', 'ไม่อนุมัติ', 'secondary', 30, TRUE, TRUE),
        ('NEED_MORE_INFO', 'ขอข้อมูลเพิ่ม (เดิม)', 'secondary', 90, TRUE, FALSE)
    `);

    await queryRunner.query(`
      ALTER TABLE student_follow_up_requests
        DROP CONSTRAINT IF EXISTS chk_follow_up_requests_assignment_state,
        DROP CONSTRAINT IF EXISTS chk_follow_up_requests_review_state,
        DROP CONSTRAINT IF EXISTS chk_follow_up_requests_status,
        ADD COLUMN opened_case_id INTEGER,
        ADD CONSTRAINT fk_follow_up_requests_opened_case
          FOREIGN KEY (opened_case_id) REFERENCES cases(id)
          ON DELETE RESTRICT ON UPDATE CASCADE;

      UPDATE student_follow_up_requests
      SET status = CASE status
        WHEN 'APPROVE_AND_ASSIGN' THEN 'APPROVED'
        WHEN 'REJECT' THEN 'REJECTED'
        ELSE status
      END,
      review_decision = CASE review_decision
        WHEN 'APPROVE_AND_ASSIGN' THEN 'APPROVED'
        WHEN 'REJECT' THEN 'REJECTED'
        ELSE review_decision
      END;

      UPDATE student_follow_up_requests request
      SET opened_case_id = task.case_id
      FROM tasks task
      WHERE task.id = request.assigned_task_id
        AND task.case_id IS NOT NULL
        AND request.opened_case_id IS NULL;

      WITH case_candidates AS (
        SELECT
          request.id AS request_id,
          nextval(pg_get_serial_sequence('cases', 'id'))::integer AS case_id,
          trim(concat_ws(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec"))
            AS student_name,
          enrollment."FirstName_Onec" AS student_first_name,
          enrollment."LastName_Onec" AS student_last_name,
          school.name AS student_school,
          NULLIF(trim(concat_ws(' ',
            enrollment.address_house_no,
            enrollment."VillageNumber_Onec",
            enrollment."Street_Onec",
            enrollment."Soi_Onec",
            enrollment."Trok_Onec",
            enrollment."SubDistrictNameThai_Onec",
            enrollment."DistrictNameThai_Onec",
            enrollment."ProvinceNameThai_Onec",
            enrollment."PostalCode_Onec"
          )), '') AS student_address,
          NULLIF(trim(concat_ws(' ',
            enrollment.address_house_no,
            enrollment."VillageNumber_Onec",
            enrollment."Street_Onec",
            enrollment."Soi_Onec",
            enrollment."Trok_Onec"
          )), '') AS address_line,
          enrollment."ProvinceNameThai_Onec" AS address_province,
          enrollment."DistrictNameThai_Onec" AS address_district,
          enrollment."SubDistrictNameThai_Onec" AS address_sub_district,
          enrollment."PostalCode_Onec" AS postal_code,
          enrollment.address_latitude AS student_lat,
          enrollment.address_longitude AS student_lng,
          request.request_reason AS reason_flagged,
          request.student_uuid,
          request.school_id,
          request.reviewed_by AS created_by
        FROM student_follow_up_requests request
        JOIN student_term enrollment
          ON enrollment.student_uuid = request.student_uuid
         AND enrollment.deleted_at IS NULL
        JOIN schools school ON school.id = request.school_id
        WHERE request.status = 'APPROVED'
          AND request.opened_case_id IS NULL
      ), inserted_cases AS (
        INSERT INTO cases (
          id, student_name, student_first_name, student_last_name, student_school,
          student_address, address_line, address_province, address_district,
          address_sub_district, postal_code, student_lat, student_lng, reason_flagged,
          student_uuid, school_id, created_by, updated_by
        )
        SELECT
          case_id, student_name, student_first_name, student_last_name, student_school,
          student_address, address_line, address_province, address_district,
          address_sub_district, postal_code, student_lat, student_lng, reason_flagged,
          student_uuid, school_id, created_by, created_by
        FROM case_candidates
        RETURNING id
      )
      UPDATE student_follow_up_requests request
      SET opened_case_id = candidate.case_id
      FROM case_candidates candidate
      WHERE request.id = candidate.request_id;

      ALTER TABLE student_follow_up_requests
        ADD CONSTRAINT fk_follow_up_requests_status
          FOREIGN KEY (status) REFERENCES student_follow_up_request_statuses(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_follow_up_requests_review_state
          CHECK (
            (status = 'PENDING_REVIEW' AND review_decision IS NULL AND review_reason IS NULL
              AND reviewed_by IS NULL AND reviewed_at IS NULL)
            OR
            (status <> 'PENDING_REVIEW' AND review_decision = status
              AND review_reason IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
          ),
        ADD CONSTRAINT chk_follow_up_requests_assignment_state
          CHECK (
            (assigned_task_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
            OR
            (status = 'APPROVED'
              AND assigned_task_id IS NOT NULL
              AND assigned_by IS NOT NULL
              AND assigned_at IS NOT NULL)
          );

      CREATE UNIQUE INDEX uq_follow_up_requests_opened_case
        ON student_follow_up_requests (opened_case_id)
        WHERE opened_case_id IS NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE student_observations
        ADD COLUMN source_task_link_id UUID,
        ADD COLUMN source_timetable_slot_id BIGINT,
        ADD COLUMN observer_display_name VARCHAR(200),
        ADD CONSTRAINT fk_student_observations_task_link
          FOREIGN KEY (source_task_link_id) REFERENCES task_links(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_student_observations_timetable_slot
          FOREIGN KEY (source_timetable_slot_id) REFERENCES timetable_slots(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_student_observations_observer_display_name
          CHECK (
            observer_display_name IS NULL
            OR length(trim(observer_display_name)) BETWEEN 1 AND 200
          ),
        ADD CONSTRAINT chk_student_observations_task_link_context
          CHECK (
            (
              source_task_link_id IS NULL
              AND source_timetable_slot_id IS NULL
              AND observer_display_name IS NULL
            )
            OR (
              author_kind = 'USER'
              AND source_task_link_id IS NOT NULL
              AND source_teacher_access_grant_id IS NULL
              AND author_teacher_membership_id IS NULL
              AND source_assignment_id IS NULL
              AND observer_display_name IS NOT NULL
            )
          );

      CREATE INDEX idx_student_observations_task_link
        ON student_observations (source_task_link_id, observed_at DESC)
        WHERE source_task_link_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_student_observations_task_link;
      ALTER TABLE student_observations
        DROP CONSTRAINT IF EXISTS chk_student_observations_task_link_context,
        DROP CONSTRAINT IF EXISTS chk_student_observations_observer_display_name,
        DROP CONSTRAINT IF EXISTS fk_student_observations_timetable_slot,
        DROP CONSTRAINT IF EXISTS fk_student_observations_task_link;

      ALTER TABLE student_observations
        DROP COLUMN IF EXISTS observer_display_name,
        DROP COLUMN IF EXISTS source_timetable_slot_id,
        DROP COLUMN IF EXISTS source_task_link_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_follow_up_requests_opened_case;
      ALTER TABLE student_follow_up_requests
        DROP CONSTRAINT IF EXISTS chk_follow_up_requests_assignment_state,
        DROP CONSTRAINT IF EXISTS chk_follow_up_requests_review_state,
        DROP CONSTRAINT IF EXISTS fk_follow_up_requests_status,
        DROP CONSTRAINT IF EXISTS fk_follow_up_requests_opened_case;

      UPDATE student_follow_up_requests
      SET status = CASE status
        WHEN 'APPROVED' THEN 'APPROVE_AND_ASSIGN'
        WHEN 'REJECTED' THEN 'REJECT'
        ELSE status
      END,
      review_decision = CASE review_decision
        WHEN 'APPROVED' THEN 'APPROVE_AND_ASSIGN'
        WHEN 'REJECTED' THEN 'REJECT'
        ELSE review_decision
      END;

      ALTER TABLE student_follow_up_requests
        DROP COLUMN IF EXISTS opened_case_id,
        ADD CONSTRAINT chk_follow_up_requests_status
          CHECK (status IN ('PENDING_REVIEW', 'APPROVE_AND_ASSIGN', 'NEED_MORE_INFO', 'REJECT')),
        ADD CONSTRAINT chk_follow_up_requests_review_state
          CHECK (
            (status = 'PENDING_REVIEW' AND review_decision IS NULL AND review_reason IS NULL
              AND reviewed_by IS NULL AND reviewed_at IS NULL)
            OR
            (status <> 'PENDING_REVIEW' AND review_decision = status
              AND review_reason IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
          ),
        ADD CONSTRAINT chk_follow_up_requests_assignment_state
          CHECK (
            (assigned_task_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
            OR
            (status = 'APPROVE_AND_ASSIGN'
              AND assigned_task_id IS NOT NULL
              AND assigned_by IS NOT NULL
              AND assigned_at IS NOT NULL)
          );
    `);
    await queryRunner.query(`DROP TABLE student_follow_up_request_statuses`);
  }
}

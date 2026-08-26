import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';

export interface StatusCatalogRow extends Record<string, unknown> {
  domain_code: string;
  code: string;
  internal_code: string | null;
  short_label_th: string | null;
  label_th: string;
  badge_variant: string;
  summary_tone: string | null;
  sort_order: number;
}

@Injectable()
export class StatusCatalogRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findAll(): Promise<StatusCatalogRow[]> {
    const result = await queryDataSource<StatusCatalogRow>(
      this.dataSource,
      `
        SELECT 'CASE_WORKFLOW' AS domain_code, code::text, NULL::text AS internal_code,
               NULL::text AS short_label_th, label_th, badge_variant, NULL::text AS summary_tone,
               sort_order
        FROM case_workflow_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'CASE_REFERRAL', code::text, NULL, NULL, label_th, badge_variant, NULL,
               sort_order
        FROM case_referral_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'STUDENT_RISK_TIER', code::text, NULL, NULL, label_th, badge_variant, summary_tone,
               sort_order
        FROM student_risk_tiers WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'USER_ACCOUNT_STATUS', code::text, NULL, NULL, label_th, badge_variant, NULL,
               sort_order
        FROM user_account_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'TASK_WORKFLOW', code::text, NULL, NULL, label_th, badge_variant, NULL,
               sort_order
        FROM task_workflow_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'TASK_LINK_STATUS', code::text, NULL, NULL, label_th, badge_variant, NULL,
               sort_order
        FROM task_link_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'ATTENDANCE_RECORD', code::text, internal_code, short_label_th, label_th,
               badge_variant, NULL, sort_order
        FROM attendance_record_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'SCHOOL_TERM', code::text, NULL, NULL, label_th, badge_variant, NULL, sort_order
        FROM school_term_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'ATTENDANCE_SESSION', code::text, NULL, NULL, label_th, badge_variant, NULL,
               sort_order
        FROM attendance_session_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'STUDENT_IMPORT_BATCH', code::text, NULL, NULL, label_th, badge_variant, NULL,
               sort_order
        FROM student_import_batch_statuses WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'STUDENT_STATUS_CATEGORY', code::text, NULL, NULL, label_th, 'secondary', NULL,
               sort_order
        FROM student_status_categories WHERE is_active = TRUE AND deleted_at IS NULL
        UNION ALL
        SELECT 'IMPORT_QUARANTINE_STATUS', code::text, NULL, NULL, label_th, badge_variant,
               NULL, sort_order
        FROM student_import_quarantine_statuses WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'IMPORT_QUARANTINE_RESOLUTION', code::text, NULL, NULL, label_th, badge_variant,
               NULL, sort_order
        FROM student_import_quarantine_resolution_statuses WHERE deleted_at IS NULL
        UNION ALL
        SELECT domain_code, code::text, NULL, NULL, label_th, badge_variant, summary_tone,
               sort_order
        FROM application_display_states WHERE is_active = TRUE AND deleted_at IS NULL
        ORDER BY domain_code, sort_order, code
      `,
    );
    return result.rows;
  }
}

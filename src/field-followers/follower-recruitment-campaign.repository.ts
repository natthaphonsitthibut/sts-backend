import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataScope } from '../auth';
import { queryDataSource } from '../database/sql-query';
import type {
  FollowerAssignmentCandidateRow,
  FollowerCampaignTargetRow,
  FollowerRecruitmentCampaignRow,
} from './follower-recruitment-campaign.types';

export interface CreateFollowerRecruitmentCampaignInput {
  name: string;
  description: string | null;
  publicCode: string;
  dataScope: DataScope;
  opensAt: Date | null;
  closesAt: Date | null;
  createdBy: number | null;
}

export interface UpdateFollowerRecruitmentCampaignInput {
  name?: string;
  description?: string | null;
  dataScope?: DataScope;
  opensAt?: Date;
  closesAt?: Date;
  isActive?: boolean;
  updatedBy: number | null;
}

const MAX_LIST_ROWS = 2000;

@Injectable()
export class FollowerRecruitmentCampaignRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    input: CreateFollowerRecruitmentCampaignInput,
  ): Promise<FollowerRecruitmentCampaignRow> {
    // Compute initial status from the time window
    const now = new Date();
    let status: 'ACTIVE' | 'EXPIRED' | 'SCHEDULED' = 'ACTIVE';
    if (input.closesAt && now >= input.closesAt) {
      status = 'EXPIRED';
    } else if (input.opensAt && now < input.opensAt) {
      status = 'SCHEDULED';
    }

    const result = await queryDataSource<FollowerRecruitmentCampaignRow>(
      this.dataSource,
      `
        INSERT INTO follower_recruitment_campaigns (
          name, description, public_code, data_scope, opens_at, closes_at, status, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $8)
        RETURNING *
      `,
      [
        input.name,
        input.description,
        input.publicCode,
        JSON.stringify(input.dataScope),
        input.opensAt,
        input.closesAt,
        status,
        input.createdBy,
      ],
    );
    return result.rows[0];
  }

  /**
   * Every non-deleted campaign, newest first, with a live submission count
   * joined in. Capped at MAX_LIST_ROWS as a safety valve, not real pagination
   * — campaign counts are expected in the hundreds (admin-managed, not
   * public-submitted rows), so scope/page filtering happens in the service
   * layer via TaskPolicyService.isScopeSubsetOfActor rather than a JSONB
   * scope-subset SQL predicate. Revisit if this table ever grows past that.
   */
  async listAll(): Promise<FollowerRecruitmentCampaignRow[]> {
    const result = await queryDataSource<FollowerRecruitmentCampaignRow>(
      this.dataSource,
      `
        SELECT c.*, COUNT(ff.id)::int AS submission_count
        FROM follower_recruitment_campaigns c
        LEFT JOIN field_followers ff ON ff.campaign_id = c.id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT ${MAX_LIST_ROWS}
      `,
    );
    return result.rows;
  }

  async findById(id: string): Promise<FollowerRecruitmentCampaignRow | null> {
    const result = await queryDataSource<FollowerRecruitmentCampaignRow>(
      this.dataSource,
      `SELECT * FROM follower_recruitment_campaigns WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByPublicCode(code: string): Promise<FollowerRecruitmentCampaignRow | null> {
    const result = await queryDataSource<FollowerRecruitmentCampaignRow>(
      this.dataSource,
      `SELECT * FROM follower_recruitment_campaigns WHERE public_code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async update(
    id: string,
    input: UpdateFollowerRecruitmentCampaignInput,
  ): Promise<FollowerRecruitmentCampaignRow | null> {
    const setClauses: string[] = [`updated_by = $1`];
    const params: unknown[] = [input.updatedBy];

    if (input.name !== undefined) {
      params.push(input.name);
      setClauses.push(`name = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      setClauses.push(`description = $${params.length}`);
    }
    if (input.dataScope !== undefined) {
      params.push(JSON.stringify(input.dataScope));
      setClauses.push(`data_scope = $${params.length}::jsonb`);
    }
    if (input.opensAt !== undefined) {
      params.push(input.opensAt);
      setClauses.push(`opens_at = $${params.length}`);
    }
    if (input.closesAt !== undefined) {
      params.push(input.closesAt);
      setClauses.push(`closes_at = $${params.length}`);
    }
    if (input.isActive !== undefined) {
      params.push(input.isActive);
      setClauses.push(`is_active = $${params.length}`);
    }

    // Re-derive status whenever is_active or the window changes. Always evaluate
    // against the *incoming* opens_at/closes_at (via COALESCE with the stored
    // value) rather than bare columns — inside an UPDATE the bare columns still
    // hold the pre-update row, so a combined "reactivate + extend window" PATCH
    // would otherwise compute status from the old dates.
    if (
      input.isActive !== undefined ||
      input.opensAt !== undefined ||
      input.closesAt !== undefined
    ) {
      params.push(input.closesAt ?? null);
      const closesParam = params.length;
      params.push(input.opensAt ?? null);
      const opensParam = params.length;
      const lockedCondition =
        input.isActive === undefined ? 'is_active = false' : input.isActive ? 'false' : 'true';
      setClauses.push(
        `status = CASE
          WHEN ${lockedCondition} THEN 'LOCKED'
          WHEN COALESCE($${closesParam}::timestamptz, closes_at) IS NOT NULL
               AND COALESCE($${closesParam}::timestamptz, closes_at) <= now() THEN 'EXPIRED'
          WHEN COALESCE($${opensParam}::timestamptz, opens_at) IS NOT NULL
               AND COALESCE($${opensParam}::timestamptz, opens_at) > now() THEN 'SCHEDULED'
          ELSE 'ACTIVE'
        END`,
      );
    }

    params.push(id);
    const result = await queryDataSource<FollowerRecruitmentCampaignRow>(
      this.dataSource,
      `
        UPDATE follower_recruitment_campaigns
        SET ${setClauses.join(', ')}
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING *
      `,
      params,
    );
    return result.rows[0] ?? null;
  }

  async softDelete(
    id: string,
    deletedBy: number | null,
  ): Promise<FollowerRecruitmentCampaignRow | null> {
    const result = await queryDataSource<FollowerRecruitmentCampaignRow>(
      this.dataSource,
      `
        UPDATE follower_recruitment_campaigns
        SET deleted_at = now(), deleted_by = $2, is_active = false
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *
      `,
      [id, deletedBy],
    );
    return result.rows[0] ?? null;
  }

  /** Best-effort page-view counter — not billing-grade, minor races are fine. */
  async incrementViewCount(id: string): Promise<void> {
    await queryDataSource(
      this.dataSource,
      `
        UPDATE follower_recruitment_campaigns
        SET view_count = view_count + 1
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [id],
    );
  }

  async addTargets(
    campaignId: string,
    caseIds: number[],
    actorId: number | null,
  ): Promise<FollowerCampaignTargetRow[]> {
    const result = await queryDataSource<FollowerCampaignTargetRow>(
      this.dataSource,
      `
        INSERT INTO follower_recruitment_campaign_targets (
          campaign_id, case_id, created_by, updated_by
        )
        SELECT $1::bigint, unnest($2::int[]), $3, $3
        ON CONFLICT (campaign_id, case_id) DO NOTHING
        RETURNING *
      `,
      [campaignId, caseIds, actorId],
    );
    if (result.rows.length === 0) {
      return await this.listTargets(campaignId);
    }
    return await this.listTargets(campaignId);
  }

  async listTargets(campaignId: string): Promise<FollowerCampaignTargetRow[]> {
    const result = await queryDataSource<FollowerCampaignTargetRow>(
      this.dataSource,
      `
        SELECT
          target.*,
          c.student_name AS case_student_name,
          c.student_uuid::text AS case_student_id,
          c.student_school AS case_student_school,
          c.student_address AS case_student_address,
          c.reason_flagged AS case_reason_flagged,
          CONCAT_WS(' ', follower.first_name, follower.last_name) AS assigned_follower_name,
          follower.email AS assigned_follower_email,
          follower.phone AS assigned_follower_phone
        FROM follower_recruitment_campaign_targets target
        JOIN cases c ON c.id = target.case_id AND c.deleted_at IS NULL
        LEFT JOIN field_followers follower ON follower.id = target.assigned_follower_id
        WHERE target.campaign_id = $1
          AND target.deleted_at IS NULL
        ORDER BY target.created_at DESC, target.id DESC
      `,
      [campaignId],
    );
    return result.rows;
  }

  async findTargetById(id: string): Promise<FollowerCampaignTargetRow | null> {
    const result = await queryDataSource<FollowerCampaignTargetRow>(
      this.dataSource,
      `
        SELECT
          target.*,
          c.student_name AS case_student_name,
          c.student_uuid::text AS case_student_id,
          c.student_school AS case_student_school,
          c.student_address AS case_student_address,
          c.reason_flagged AS case_reason_flagged,
          CONCAT_WS(' ', follower.first_name, follower.last_name) AS assigned_follower_name,
          follower.email AS assigned_follower_email,
          follower.phone AS assigned_follower_phone
        FROM follower_recruitment_campaign_targets target
        JOIN cases c ON c.id = target.case_id AND c.deleted_at IS NULL
        LEFT JOIN field_followers follower ON follower.id = target.assigned_follower_id
        WHERE target.id = $1
          AND target.deleted_at IS NULL
        LIMIT 1
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findActiveFollowerForCampaign(
    followerId: number,
    campaignId: string,
  ): Promise<FollowerAssignmentCandidateRow | null> {
    const result = await queryDataSource<FollowerAssignmentCandidateRow>(
      this.dataSource,
      `
        SELECT id, first_name, last_name, phone, email, status, campaign_id
        FROM field_followers
        WHERE id = $1
          AND campaign_id = $2
          AND status = 'ACTIVE'
        LIMIT 1
      `,
      [followerId, campaignId],
    );
    return result.rows[0] ?? null;
  }
}

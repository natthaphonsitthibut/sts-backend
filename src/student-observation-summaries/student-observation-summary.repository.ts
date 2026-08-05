import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  ObservationSummaryAdapterResult,
  ObservationSummaryRow,
  ObservationSummarySourceRow,
} from './student-observation-summary.types';

@Injectable()
export class StudentObservationSummaryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(operation: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const result = await operation(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async findEnrollment(
    studentUuid: string,
  ): Promise<{ student_uuid: string; school_id: number } | null> {
    const result = await queryDataSource<{ student_uuid: string; school_id: number }>(
      this.dataSource,
      `SELECT student_uuid::text, "SchoolID_Onec" AS school_id
       FROM student_term
       WHERE student_uuid = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async isSchoolInScope(schoolId: number, scope: DataScope): Promise<boolean> {
    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
      },
      2,
    );
    const result = await queryDataSource(
      this.dataSource,
      `SELECT 1 FROM schools school
       WHERE school.id = $1 AND school.school_status = 'ACTIVE'
         AND ${scoped.sql || 'FALSE'} LIMIT 1`,
      [schoolId, ...scoped.params],
    );
    return result.rows.length > 0;
  }

  async listSources(
    studentUuid: string,
    schoolId: number,
    observationIds?: string[],
  ): Promise<ObservationSummarySourceRow[]> {
    const result = await queryDataSource<ObservationSummarySourceRow>(
      this.dataSource,
      `
      SELECT observation.id::text AS observation_id,
             observation.revision_number AS observation_revision,
             dimension.code AS dimension_code,
             observation.concern_level,
             observation.comment,
             observation.observed_at,
             COALESCE(tags.tag_codes, ARRAY[]::text[]) AS tag_codes
      FROM student_observations observation
      JOIN observation_dimensions dimension ON dimension.id = observation.observation_dimension_id
      LEFT JOIN LATERAL (
        SELECT array_agg(tag.code ORDER BY tag.code) AS tag_codes
        FROM student_observation_tags link
        JOIN observation_behavior_tags tag ON tag.id = link.behavior_tag_id
        WHERE link.observation_id = observation.id
      ) tags ON TRUE
      WHERE observation.student_uuid = $1
        AND observation.school_id = $2
        AND ($3::bigint[] IS NULL OR observation.id = ANY($3::bigint[]))
      ORDER BY observation.observed_at, observation.id
      LIMIT 100
    `,
      [studentUuid, schoolId, observationIds?.map(Number) ?? null],
    );
    return result.rows;
  }

  private summarySelect(): string {
    return `SELECT summary.*,
      COALESCE(citations.items, '[]'::jsonb) AS citations
      FROM student_observation_summaries summary
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'observationId', source.observation_id::text,
          'observationRevision', source.observation_revision,
          'order', source.citation_order
        ) ORDER BY source.citation_order) AS items
        FROM student_observation_summary_sources source
        WHERE source.summary_id = summary.id
      ) citations ON TRUE`;
  }

  async findByFingerprint(
    studentUuid: string,
    fingerprint: string,
  ): Promise<ObservationSummaryRow | null> {
    const result = await queryDataSource<ObservationSummaryRow>(
      this.dataSource,
      `${this.summarySelect()}
       WHERE summary.student_uuid = $1 AND summary.input_fingerprint = $2
       ORDER BY summary.generated_at DESC LIMIT 1`,
      [studentUuid, fingerprint],
    );
    return result.rows[0] ?? null;
  }

  async findLatest(studentUuid: string): Promise<ObservationSummaryRow | null> {
    const result = await queryDataSource<ObservationSummaryRow>(
      this.dataSource,
      `${this.summarySelect()}
       WHERE summary.student_uuid = $1
       ORDER BY summary.generated_at DESC, summary.id DESC LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async createSummary(
    input: {
      studentUuid: string;
      schoolId: number;
      actorId: number;
      fingerprint: string;
      output: ObservationSummaryAdapterResult;
    },
    sources: ObservationSummarySourceRow[],
    runner: QueryRunner,
  ): Promise<ObservationSummaryRow> {
    const executor = createSqlQueryExecutor(runner);
    await executor.query(
      `UPDATE student_observation_summaries
      SET is_stale = TRUE, updated_at = now()
      WHERE student_uuid = $1 AND is_stale = FALSE`,
      [input.studentUuid],
    );
    const inserted = await executor.query<{ id: string }>(
      `
      INSERT INTO student_observation_summaries (
        student_uuid, school_id, requested_by_user_id, input_fingerprint,
        provider_code, model_code, prompt_version, summary_text,
        themes, trends, agreements, conflicting_evidence, source_observation_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13)
      ON CONFLICT (student_uuid, input_fingerprint, provider_code, model_code, prompt_version)
      DO UPDATE SET updated_at = student_observation_summaries.updated_at
      RETURNING id::text
    `,
      [
        input.studentUuid,
        input.schoolId,
        input.actorId,
        input.fingerprint,
        input.output.providerCode,
        input.output.modelCode,
        input.output.promptVersion,
        input.output.summaryText,
        JSON.stringify(input.output.themes),
        JSON.stringify(input.output.trends),
        JSON.stringify(input.output.agreements),
        JSON.stringify(input.output.conflictingEvidence),
        sources.length,
      ],
    );
    const summaryId = inserted.rows[0].id;
    await executor.query(
      `INSERT INTO student_observation_summary_sources
      (summary_id, observation_id, observation_revision, citation_order)
      SELECT $1, citation.observation_id, citation.observation_revision, citation.ordinality - 1
      FROM jsonb_to_recordset($2::jsonb) WITH ORDINALITY
        AS citation(observation_id bigint, observation_revision integer, ordinality bigint)
      ON CONFLICT DO NOTHING`,
      [
        summaryId,
        JSON.stringify(
          input.output.citations.map((citation) => ({
            observation_id: citation.observationId,
            observation_revision: citation.revision,
          })),
        ),
      ],
    );
    const result = await executor.query<ObservationSummaryRow>(
      `${this.summarySelect()}
      WHERE summary.id = $1`,
      [summaryId],
    );
    return result.rows[0];
  }

  async markStale(summaryId: string): Promise<void> {
    await queryDataSource(
      this.dataSource,
      `UPDATE student_observation_summaries SET is_stale = TRUE, updated_at = now()
       WHERE id = $1 AND is_stale = FALSE`,
      [summaryId],
    );
  }

  async review(
    summaryId: string,
    studentUuid: string,
    input: {
      decision: 'REVIEWED' | 'REJECTED';
      actorId: number;
      actorLabel: string;
      note: string | null;
    },
    runner: QueryRunner,
  ): Promise<ObservationSummaryRow | null> {
    const executor = createSqlQueryExecutor(runner);
    const result = await executor.query<ObservationSummaryRow>(
      `
      WITH updated AS (
        UPDATE student_observation_summaries SET review_state=$3, reviewed_by_user_id=$4,
          reviewer_display_name=$5, review_note=$6, reviewed_at=now(), updated_at=now()
        WHERE id=$1 AND student_uuid=$2 AND review_state='PENDING_REVIEW'
        RETURNING *
      ) SELECT updated.*, COALESCE(citations.items, '[]'::jsonb) AS citations
        FROM updated LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('observationId', source.observation_id::text,
            'observationRevision', source.observation_revision, 'order', source.citation_order)
            ORDER BY source.citation_order) AS items
          FROM student_observation_summary_sources source WHERE source.summary_id=updated.id
        ) citations ON TRUE
    `,
      [summaryId, studentUuid, input.decision, input.actorId, input.actorLabel, input.note],
    );
    return result.rows[0] ?? null;
  }
}

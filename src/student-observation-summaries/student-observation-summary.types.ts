export interface ObservationSummarySourceRow extends Record<string, unknown> {
  observation_id: string;
  observation_revision: number;
  dimension_code: string;
  concern_level: string;
  comment: string | null;
  observed_at: Date | string;
  tag_codes: string[];
}

export interface ObservationSummaryRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  school_id: number;
  input_fingerprint: string;
  provider_code: string;
  model_code: string;
  prompt_version: string;
  summary_text: string;
  themes: string[];
  trends: string[];
  agreements: string[];
  conflicting_evidence: string[];
  source_observation_count: number;
  is_stale: boolean;
  review_state: 'PENDING_REVIEW' | 'REVIEWED' | 'REJECTED';
  reviewed_by_user_id: number | null;
  reviewer_display_name: string | null;
  review_note: string | null;
  reviewed_at: Date | string | null;
  generated_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  citations: Array<{ observationId: string; observationRevision: number; order: number }>;
}

export interface ObservationSummaryAdapterInput {
  sources: Array<{
    observationId: string;
    revision: number;
    dimensionCode: string;
    concernLevel: string;
    comment: string | null;
    observedAt: string;
    tagCodes: string[];
  }>;
}

export interface ObservationSummaryAdapterResult {
  providerCode: string;
  modelCode: string;
  promptVersion: string;
  summaryText: string;
  themes: string[];
  trends: string[];
  agreements: string[];
  conflictingEvidence: string[];
  citations: Array<{ observationId: string; revision: number }>;
}

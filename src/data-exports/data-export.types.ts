export type DataExportSensitivityClass =
  | 'LOW'
  | 'AGGREGATE'
  | 'OPERATIONAL'
  | 'SENSITIVE_OPERATIONAL'
  | 'SENSITIVE_PII'
  | 'PRIVILEGED';

export type DataExportDeliveryMode = 'ASYNC_JOB' | 'EXISTING_WORKFLOW';

export interface DataExportCatalogItem {
  code: string;
  label: string;
  description: string;
  sensitivityClass: DataExportSensitivityClass;
  formats: string[];
  fieldBundles: Array<{
    code: string;
    label: string;
    description: string;
  }>;
  supportedFilters: string[];
  requiredPermissions: string[];
  deliveryMode: DataExportDeliveryMode;
  workflowPath?: string;
  status: 'AVAILABLE' | 'PLANNED';
}

export type DataExportJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED';

export interface DataExportJobRow extends Record<string, unknown> {
  id: string;
  dataset_code: string;
  field_bundle_code: string;
  output_format: 'CSV';
  sensitivity_class: DataExportSensitivityClass;
  status: DataExportJobStatus;
  requested_by: number;
  scope_snapshot: Record<string, unknown>;
  filter_snapshot: Record<string, unknown>;
  purpose_code: string | null;
  purpose_note: string | null;
  estimated_row_count: number | string | null;
  exported_row_count: number | string | null;
  artifact_size_bytes: number | string | null;
  progress_percent: number | string;
  artifact_storage_key: string | null;
  artifact_sha256: string | null;
  failure_code: string | null;
  failure_summary: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  canceled_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface DataExportJobResponse {
  id: string;
  datasetCode: string;
  fieldBundleCode: string;
  outputFormat: 'CSV';
  sensitivityClass: DataExportSensitivityClass;
  status: DataExportJobStatus;
  progressPercent: number;
  exportedRowCount: number | null;
  artifactSizeBytes: number | null;
  failureCode: string | null;
  failureSummary: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkSessionEndReason = 'MANUAL' | 'SUBMITTED' | 'TIMEOUT';

export interface VisitWorkSessionRow extends Record<string, unknown> {
  id: string;
  task_link_id: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  end_reason: WorkSessionEndReason | null;
  consent_at: Date | string;
}

export interface MonitorWorkSessionRow extends Record<string, unknown> {
  session_id: string;
  task_link_id: string;
  started_at: Date | string;
  consent_at: Date | string;
  assigned_to_name: string | null;
  student_name: string | null;
  school_name: string | null;
  last_ping_lat: number | null;
  last_ping_lng: number | null;
  last_ping_at: Date | string | null;
}

export interface RecentlyEndedWorkSessionRow extends Record<string, unknown> {
  session_id: string;
  task_link_id: string;
  started_at: Date | string;
  ended_at: Date | string;
  end_reason: WorkSessionEndReason;
  assigned_to_name: string | null;
  student_name: string | null;
}

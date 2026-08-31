import type { MessagingFriendState } from '../common/messaging/messaging.types';

export interface TeacherLineIdentityRow extends Record<string, unknown> {
  teacher_id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface TeacherLineCitizenIdentityRow extends Record<string, unknown> {
  teacher_id: string;
  first_name: string;
  last_name: string;
}

export interface TeacherMessagingAccountRow extends Record<string, unknown> {
  id: string;
  teacher_id: string;
  provider: string;
  provider_channel_id: string;
  provider_user_id: string;
  display_name: string | null;
  friend_state: MessagingFriendState;
  friend_checked_at: string | null;
  verified_at: string;
}

export interface TeacherLineGroupInvitationRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  school_name: string;
  token_hash: string;
  token_encrypted: string;
  issued_by: number;
  issued_at: string | Date;
  starts_at: string | Date;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  revoked_by: number | null;
  revocation_reason: string | null;
}

/** Why a callback ended the way it did; drives which result screen is shown. */
export type TeacherLineLinkOutcome =
  | 'SUCCESS'
  | 'NOT_FRIEND'
  | 'TEACHER_ALREADY_LINKED'
  | 'ALREADY_LINKED_TO_ANOTHER_TEACHER'
  | 'EXPIRED'
  | 'FAILED';

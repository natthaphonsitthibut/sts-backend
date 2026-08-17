import type { ActorContext } from '../../auth/auth.types';

/**
 * Helpers for filling the standard audit `*_by` columns (audit-columns standard,
 * Phase 1) from the authenticated actor — so services don't hardcode the actor
 * id per query. Pair with the SQL columns from {@link AUDIT_COLUMNS_SQL}.
 */

export interface AuditCreateColumns {
  created_by: number | null;
  updated_by: number | null;
}

export interface AuditUpdateColumns {
  updated_by: number | null;
}

export interface AuditSoftDeleteColumns {
  deleted_by: number | null;
}

/**
 * Resolve the actor id for `*_by` columns. Returns the id ONLY for a real,
 * persisted local user. External and magic-link actors are not rows
 * in `users` (and may carry a synthetic/negative id), so they resolve to null
 * to keep the FK to users(id) valid.
 */
export function resolveAuditActorId(actor?: ActorContext | null): number | null {
  if (!actor) {
    return null;
  }
  return Number.isInteger(actor.id) && actor.id > 0 ? actor.id : null;
}

/** Columns to set on INSERT: stamps both created_by and updated_by. */
export function auditColumnsForCreate(actor?: ActorContext | null): AuditCreateColumns {
  const actorId = resolveAuditActorId(actor);
  return { created_by: actorId, updated_by: actorId };
}

/** Columns to set on UPDATE. (updated_at is handled by the DB trigger.) */
export function auditColumnsForUpdate(actor?: ActorContext | null): AuditUpdateColumns {
  return { updated_by: resolveAuditActorId(actor) };
}

/** Columns to set on a soft delete (also set deleted_at = now() in the query). */
export function auditColumnsForSoftDelete(actor?: ActorContext | null): AuditSoftDeleteColumns {
  return { deleted_by: resolveAuditActorId(actor) };
}

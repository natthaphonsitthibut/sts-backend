/**
 * The one implementation of the role ladder.
 *
 * "Which accounts may I manage" used to be a numeric `roles.rank`; since
 * 2026-08-17 it is the same question as everything else about permissions — a
 * menu group you can manage may not reach a page you do not hold. The rule lived
 * in two services word for word (as `getRoleRank` did before it), which is how a
 * security check drifts: one copy gets fixed and the other does not.
 *
 * Role *defaults* are the ceiling being compared, not an account's own list, so
 * ticking pages off one account never widens what its owner can do to others.
 */

/** Only the part of a role row this rule needs; both services' shapes satisfy it. */
export interface RoleAuthorityDefinition {
  default_permissions: string[];
}

export function canManageRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
  roleMap: Map<string, RoleAuthorityDefinition>,
): boolean {
  if (!targetRole) return true;
  if (actorRole && targetRole === actorRole) return actorRole === 'ADMIN';

  // A role the catalogue does not offer (`is_assignable = false`, so absent from
  // the map) must fail closed. Treating "no pages found" as "no pages to clear"
  // would have let any actor manage such an account, because [].every() is true.
  const target = roleMap.get(targetRole);
  const actor = actorRole ? roleMap.get(actorRole) : undefined;
  if (!target || !actor) return false;

  const actorPages = new Set(actor.default_permissions ?? []);
  return (target.default_permissions ?? []).every((page) => actorPages.has(page));
}

/**
 * Whether assigning `requestedRole` would hand out a page the actor lacks.
 * Same comparison as above, phrased for the write path.
 */
export function roleReachesFurtherThanActor(
  actorRole: string | null | undefined,
  requestedRole: string | null | undefined,
  roleMap: Map<string, RoleAuthorityDefinition>,
): boolean {
  const requested = requestedRole ? roleMap.get(requestedRole) : undefined;
  if (!requested) return true;

  const actorPages = new Set(
    (actorRole ? roleMap.get(actorRole)?.default_permissions : undefined) ?? [],
  );
  return (requested.default_permissions ?? []).some((page) => !actorPages.has(page));
}

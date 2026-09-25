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

import { APP_PAGES } from './page-registry.constants';

/**
 * Pages whose holder administers other accounts. Holding one lets an actor hand
 * out any page of the realm it administers, not only the pages it opens itself:
 * a school's ผู้ดูแลระบบ does not read รายชื่อนักเรียน, yet must be able to create
 * that school's ผู้อำนวยการ, who does (owner, 2026-09-25: "ตามภาพ + แก้กฎ").
 */
const ACCOUNT_ADMIN_PAGES = ['manage-users-list', 'manage-role-groups'];

/**
 * Pages that stay out of reach unless actually held: the council's pages. The
 * `global-only` ones carry one national value for every school, and the rest
 * (แชตบอท) are marked `held-only` — either way, administering a school's
 * accounts must never be a way to hand them out.
 */
const HELD_ONLY_PAGES = new Set(
  APP_PAGES.filter(
    (page) => page.scopePolicy === 'global-only' || page.grantPolicy === 'held-only',
  ).map((page) => page.id),
);

const REALM_PAGES = APP_PAGES.map((page) => page.id).filter((id) => !HELD_ONLY_PAGES.has(id));

/** Every page an actor holding `actorPages` may hand to someone else. */
export function grantablePages(actorPages: Iterable<string>): Set<string> {
  const grantable = new Set(actorPages);
  if (ACCOUNT_ADMIN_PAGES.some((page) => grantable.has(page))) {
    for (const page of REALM_PAGES) grantable.add(page);
  }
  return grantable;
}

/** Whether an actor holding `actorPages` may grant every one of `targetPages`. */
export function canGrantPages(actorPages: string[], targetPages: string[]): boolean {
  if (actorPages.includes('*') || actorPages.includes('ALL')) return true;
  const grantable = grantablePages(actorPages);
  return targetPages.every((page) => grantable.has(page));
}

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

  return canGrantPages(actor.default_permissions ?? [], target.default_permissions ?? []);
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

  const actorPages = (actorRole ? roleMap.get(actorRole)?.default_permissions : undefined) ?? [];
  return !canGrantPages(actorPages, requested.default_permissions ?? []);
}

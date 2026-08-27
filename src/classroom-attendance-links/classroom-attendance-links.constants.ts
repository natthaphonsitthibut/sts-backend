export const CLASSROOM_LINK_TOKEN_HEADER = 'x-classroom-link-token';
export const CLASSROOM_LINK_SESSION_COOKIE = 'classroom_check_in_session';
// The page a classroom link opens. It is a teacher's whole classroom — roster,
// attendance, student profiles — so the path is named after the room, not after
// the one task it started as. `/check-in` still resolves: the frontend keeps a
// redirect for links already handed out.
export const CLASSROOM_LINK_PATH = '/classroom';
export const CLASSROOM_LINK_ARAID_SCOPE = 'classroom-check-in' as const;

/** Canonical API namespace; the old one stays mounted for in-flight links. */
export const CLASSROOM_LINK_API_PATH = 'api/classroom';
export const CLASSROOM_LINK_LEGACY_API_PATH = 'api/check-in';
export const CLASSROOM_LINK_COOKIE_PATH = '/api/classroom';

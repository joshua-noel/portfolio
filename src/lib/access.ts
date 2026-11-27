/**
 * Who may read what. This is the only place that decides: pages, search, the
 * sitemap, media and every JSON endpoint ask `canRead`, and the catalog hands
 * out a locked stub in place of anything it answers "no" to, so a template
 * cannot leak a field it was never given.
 *
 * Deny by default. A visibility or a role this file does not know reads as no
 * access, and `public` is the only thing a visitor with no account may read.
 */

export const ROLES = ["admin", "friend", "member"] as const;
export type Role = (typeof ROLES)[number];

/** A role from outside (a cookie row, a database column): known, or nothing. */
export function parseRole(value: unknown): Role | undefined {
  return ROLES.find((role) => role === value);
}

/**
 *   public   everyone
 *   members  member, friend, admin
 *   friends  friend, admin
 *   local    nobody: a server does not serve it. `allowLocal` is the owner's
 *            switch for their own machine (PORTFOLIO_LEARN_ALLOW_LOCAL=1, which
 *            the configuration refuses off loopback); then it reads as public.
 */
export function canRead(visibility: unknown, role: unknown, allowLocal = false): boolean {
  if (visibility === "public") return true;
  if (visibility === "local") return allowLocal === true;
  const known = parseRole(role);
  if (known === undefined) return false;
  switch (visibility) {
    case "members":
      return true; // any known role
    case "friends":
      return known === "friend" || known === "admin";
    default:
      return false;
  }
}

/** Why a reader is told no, for the page that stands in for the lecture. */
export function whyLocked(visibility: unknown): string {
  switch (visibility) {
    case "members":
      return "This is for members. Membership is not open yet.";
    case "friends":
      return "This is for friends of the site.";
    default:
      return "This is not available to read here.";
  }
}

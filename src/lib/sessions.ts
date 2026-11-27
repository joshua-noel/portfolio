import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseRole, type Role } from "./access.ts";
import { safeEqual } from "./password.ts";

/**
 * Sessions for both sites, on handles so they can be tested without a
 * server. A session has a scope, and a token only ever validates in its own:
 *
 *   admin  the blog host's admin; only the environment admin has one
 *   learn  the lecture host; a user's, or the environment admin's
 *
 * The browser keeps the two in different, host-only cookies, and this is the
 * second wall: a learn token pasted into the admin's cookie is not found.
 */
export type Scope = "admin" | "learn";

/** The lecture host's cookie on plain http (local development). */
export const LEARN_COOKIE = "learn_session";

/**
 * On https the cookie is named with the `__Host-` prefix, which a browser
 * accepts only if it is Secure, has Path=/ and carries no Domain. A script on
 * the main or blog host can set a `Domain=` cookie that the lecture host
 * would receive under the plain name (cookie tossing); under this name it
 * cannot, and the server reads no other name on https.
 */
export const LEARN_COOKIE_HOST = "__Host-learn_session";

/** The name the lecture host's cookie has for a request to `url`. */
export const learnCookieName = (url: URL): string =>
  url.protocol === "https:" ? LEARN_COOKIE_HOST : LEARN_COOKIE;

export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface Principal {
  username: string;
  role: Role;
  /** Null for the environment admin, who has no row in `users`. */
  userId: number | null;
}

/**
 * A short fingerprint of the environment admin's configured password hash,
 * kept with each of its sessions. A new password is a new hash (it has a new
 * salt), so every session made under the old one stops validating.
 */
export const credentialFingerprint = (passwordHash: string): string =>
  createHash("sha256").update(`credential:${passwordHash}`).digest("hex").slice(0, 32);

/** The environment admin, as session lookups need to know it. */
export interface Bootstrap {
  username: string;
  /** `credentialFingerprint` of the configured password hash. */
  credential: string;
}

const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Returns the opaque token; only its SHA-256 is ever stored. */
export function createSession(
  handle: DatabaseSync,
  now: number,
  {
    scope,
    userId = null,
    role = null,
    credential = null,
  }: {
    scope: Scope;
    userId?: number | null;
    role?: Role | null;
    /** For the environment admin's sessions: `credentialFingerprint` of its password hash. */
    credential?: string | null;
  },
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_SECONDS;
  handle
    .prepare(
      "INSERT INTO sessions (token_hash, created_at, expires_at, scope, user_id, role, credential) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(tokenHash(token), now, expiresAt, scope, userId, role, credential);
  // Opportunistic sweep: expiry is cheap to clean up where we already write.
  handle.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return { token, expiresAt };
}

interface Row {
  user_id: number | null;
  session_role: string | null;
  credential: string | null;
  username: string | null;
  user_role: string | null;
  disabled: number | null;
}

/**
 * Who a token belongs to, in this scope, right now. A session with a user
 * takes that account's current role, so a role change or a disabled flag
 * bites on the next request; one without a user is the environment admin's.
 */
export function lookupSession(
  handle: DatabaseSync,
  token: string | undefined,
  scope: Scope,
  now: number,
  bootstrap: Bootstrap,
): Principal | undefined {
  if (!token) return undefined;
  const row = handle
    .prepare(
      `SELECT s.user_id, s.role AS session_role, s.credential, u.username, u.role AS user_role, u.disabled
         FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND s.scope = ?`,
    )
    .get(tokenHash(token), now, scope) as Row | undefined;
  if (!row) return undefined;

  if (row.user_id === null) {
    // The environment admin: the only account with no row, and only as admin,
    // and only while its password is the one the session was made under.
    return row.session_role === "admin" &&
      row.credential !== null &&
      safeEqual(row.credential, bootstrap.credential)
      ? { username: bootstrap.username, role: "admin", userId: null }
      : undefined;
  }
  // The admin site has no accounts but the environment admin's.
  if (scope === "admin") return undefined;
  const role = parseRole(row.user_role);
  if (row.username === null || role === undefined || row.disabled !== 0) return undefined;
  return { username: row.username, role, userId: row.user_id };
}

export function destroySession(handle: DatabaseSync, token: string | undefined): void {
  if (!token) return;
  handle.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function destroyUserSessions(handle: DatabaseSync, userId: number): void {
  handle.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

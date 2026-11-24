import { getConfig } from "./config.ts";
import { getDb, now } from "./db.ts";
import { safeEqual, verifyPassword } from "./password.ts";
import {
  SESSION_TTL_SECONDS,
  createSession as insertSession,
  destroySession as deleteSession,
  lookupSession,
  type Principal,
  type Scope,
} from "./sessions.ts";

export { SESSION_TTL_SECONDS };

/** The blog host's admin cookie. The lecture host has its own: LEARN_COOKIE. */
export const SESSION_COOKIE = "portfolio_session";

/** The lecture host's cookie: another name, and host-only like the admin's. */
export const LEARN_COOKIE = "learn_session";

/** Creates an admin session (the environment admin's), unless told another scope. */
export function createSession(options: { scope?: Scope; userId?: number | null } = {}): {
  token: string;
  expiresAt: number;
} {
  const scope = options.scope ?? "admin";
  return insertSession(getDb(), now(), {
    scope,
    userId: options.userId ?? null,
    // The environment admin's sessions carry the role; a user's come from the account.
    role: options.userId == null ? "admin" : null,
  });
}

/** Whether a token is a live admin-scope session: the blog admin's check, unchanged. */
export function validateSession(token: string | undefined): boolean {
  return (
    lookupSession(getDb(), token, "admin", now(), getConfig().adminUsername) !== undefined
  );
}

/** Who a lecture-host cookie belongs to, or nobody. */
export function learnViewer(token: string | undefined): Principal | undefined {
  return lookupSession(getDb(), token, "learn", now(), getConfig().adminUsername);
}

export function destroySession(token: string | undefined): void {
  deleteSession(getDb(), token);
}

export { clearFailures, isLockedOut, recordFailure } from "./throttle.ts";

export async function checkCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const config = getConfig();
  const userMatch = safeEqual(username, config.adminUsername);
  // Run the KDF regardless, so a wrong username is not measurably faster
  // than a wrong password.
  const passMatch = await verifyPassword(password, config.adminPasswordHash);
  return userMatch && passMatch;
}

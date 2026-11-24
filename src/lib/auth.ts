import { getConfig } from "./config.ts";
import { getDb, now } from "./db.ts";
import { safeEqual, verifyPassword } from "./password.ts";
import {
  SESSION_TTL_SECONDS,
  credentialFingerprint,
  createSession as insertSession,
  destroySession as deleteSession,
  lookupSession,
  type Bootstrap,
  type Principal,
  type Scope,
} from "./sessions.ts";

export { SESSION_TTL_SECONDS };

/** The blog host's admin cookie. The lecture host has its own: LEARN_COOKIE. */
export const SESSION_COOKIE = "portfolio_session";

export { LEARN_COOKIE, LEARN_COOKIE_HOST, learnCookieName } from "./sessions.ts";

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
    credential:
      options.userId == null
        ? credentialFingerprint(getConfig().adminPasswordHash)
        : null,
  });
}

/** Whether a token is a live admin-scope session: the blog admin's check, unchanged. */
export function validateSession(token: string | undefined): boolean {
  return lookupSession(getDb(), token, "admin", now(), bootstrap()) !== undefined;
}

/** The environment admin, with the fingerprint of the password it signs in with today. */
function bootstrap(): Bootstrap {
  const { adminUsername, adminPasswordHash } = getConfig();
  return { username: adminUsername, credential: credentialFingerprint(adminPasswordHash) };
}

/** Who a lecture-host cookie belongs to, or nobody. */
export function learnViewer(token: string | undefined): Principal | undefined {
  return lookupSession(getDb(), token, "learn", now(), bootstrap());
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

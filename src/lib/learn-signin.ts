import type { DatabaseSync } from "node:sqlite";
import { authenticate, normalizeUsername } from "./users.ts";
import { clearFailures, isLockedOut, recordFailure } from "./throttle.ts";
import {
  createSession,
  credentialFingerprint,
  destroySession,
  type Principal,
} from "./sessions.ts";

export type SignIn =
  | { kind: "ok"; token: string; expiresAt: number; principal: Principal }
  | { kind: "failed" }
  | { kind: "locked" };

/**
 * One attempt to sign in on the lecture host. Throttled before any key
 * derivation runs: by address (any name), and by name *and* address. The name
 * is counted whether or not it exists, so a lockout does not say which names
 * are real. Every failure is the same `failed`. A success always makes a new
 * session and deletes the one the browser sent (rotation), so a token planted
 * before sign-in is worthless after it.
 *
 * There is deliberately no counter on the name alone. Whoever fails five
 * times against a name would lock its owner out of their own account from
 * anywhere, and a ceiling high enough not to do that stops nothing: every
 * guess already costs one 16 MiB key derivation, and each address gets five
 * tries per lockout window. A correct password from an address that is not
 * itself locked is therefore never refused for what other addresses did.
 */
export async function signIn(args: {
  handle: DatabaseSync;
  now: number;
  bootstrap: { username: string; passwordHash: string };
  ip: string;
  username: unknown;
  password: unknown;
  /** The session cookie the browser sent with the request, if any. */
  oldToken?: string;
}): Promise<SignIn> {
  const { handle, now, bootstrap, ip, username, password, oldToken } = args;
  const typed = (
    normalizeUsername(username) ??
    String(username ?? "")
      .trim()
      .toLowerCase()
  ).slice(0, 64);
  const keys = [`learn-ip:${ip}`, `learn-user:${typed}@${ip}`];

  if (keys.some((key) => isLockedOut(key, now))) return { kind: "locked" };

  const principal = await authenticate(handle, bootstrap, username, password);
  if (!principal) {
    for (const key of keys) recordFailure(key, now);
    return { kind: "failed" };
  }

  for (const key of keys) clearFailures(key);
  destroySession(handle, oldToken);
  const { token, expiresAt } = createSession(handle, now, {
    scope: "learn",
    userId: principal.userId,
    role: principal.userId === null ? "admin" : null,
    credential:
      principal.userId === null ? credentialFingerprint(bootstrap.passwordHash) : null,
  });
  return { kind: "ok", token, expiresAt, principal };
}

import type { DatabaseSync } from "node:sqlite";
import { authenticate, normalizeUsername } from "./users.ts";
import { clearFailures, isLockedOut, recordFailure } from "./throttle.ts";
import { createSession, destroySession, type Principal } from "./sessions.ts";

export type SignIn =
  | { kind: "ok"; token: string; expiresAt: number; principal: Principal }
  | { kind: "failed" }
  | { kind: "locked" };

/**
 * One attempt to sign in on the lecture host. Throttled by address and by the
 * name typed, before any key derivation runs, and the name is counted whether
 * or not it exists, so a lockout does not say which names are real. Every
 * failure is the same `failed`. A success always makes a new session and
 * deletes the one the browser sent (rotation), so a token planted before
 * sign-in is worthless after it.
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
  const keys = [`learn-ip:${ip}`, `learn-user:${typed}`];

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
  });
  return { kind: "ok", token, expiresAt, principal };
}

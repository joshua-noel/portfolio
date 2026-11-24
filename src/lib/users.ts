import type { DatabaseSync } from "node:sqlite";
import { parseRole, type Role } from "./access.ts";
import { hashPassword, safeEqual, verifyPassword } from "./password.ts";
import type { Principal } from "./sessions.ts";

/** Lower-case letters, digits and `._-`; 2 to 32 characters. No Unicode, so no look-alikes. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/** A username as stored, or undefined when it cannot be one. */
export function normalizeUsername(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const name = input.trim().toLowerCase();
  return USERNAME.test(name) ? name : undefined;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at: number;
  disabled: number;
}

export function findUser(handle: DatabaseSync, username: string): UserRow | undefined {
  return handle.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    UserRow | undefined;
}

/** For tests and tools that hold a handle; `bin/user.mjs` is the way an owner adds one. */
export function addUser(
  handle: DatabaseSync,
  {
    username,
    password,
    role,
    now,
  }: { username: string; password: string; role: Role; now: number },
): number {
  const name = normalizeUsername(username);
  if (name === undefined) throw new Error(`"${username}" cannot be a username`);
  const result = handle
    .prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(name, hashPassword(password), role, now);
  return Number(result.lastInsertRowid);
}

const MAX_PASSWORD = 1024;

// One real hash, made on first use, so an unknown name costs what a known one does.
let dummy: string | undefined;
const dummyHash = (): string => (dummy ??= hashPassword("not-a-password-anyone-has"));

/**
 * Checks a sign-in. Exactly one key derivation runs whatever the answer: the
 * account's hash, the environment admin's, or a dummy for a name that does not
 * exist or cannot exist, so an unknown name is not faster than a wrong
 * password. A disabled account fails after the derivation, and every failure
 * is the same `undefined`: the caller cannot tell them apart, and neither can
 * the person typing.
 */
export async function authenticate(
  handle: DatabaseSync,
  bootstrap: { username: string; passwordHash: string },
  usernameInput: unknown,
  password: unknown,
): Promise<Principal | undefined> {
  const typed =
    typeof usernameInput === "string" ? usernameInput.trim().toLowerCase() : "";
  const isBootstrap = typed !== "" && safeEqual(typed, bootstrap.username.toLowerCase());
  const name = isBootstrap ? undefined : normalizeUsername(usernameInput);
  const user = name === undefined ? undefined : findUser(handle, name);

  const usable = typeof password === "string" && password.length <= MAX_PASSWORD;
  const hash = isBootstrap
    ? bootstrap.passwordHash
    : (user?.password_hash ?? dummyHash());
  const matches = await verifyPassword(
    usable ? password : "",
    usable ? hash : dummyHash(),
  );
  if (!usable || !matches) return undefined;

  if (isBootstrap) return { username: bootstrap.username, role: "admin", userId: null };
  const role = parseRole(user?.role);
  if (!user || role === undefined || user.disabled !== 0) return undefined;
  return { username: user.username, role, userId: user.id };
}

/**
 * Where to go after signing in or out: a path on this host and nothing else.
 * Resolved the way the browser will, which is what catches `//evil.example`,
 * `/\evil.example` and `https:…`; the sign-in and sign-out pages themselves
 * are refused so a sign-in cannot bounce.
 */
export function safeNext(value: unknown, base: URL): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return "/";
  const url = URL.parse(value, base);
  if (!url || url.origin !== base.origin) return "/";
  if (/^\/sign(in|out)(\/|$)/.test(url.pathname)) return "/";
  return url.pathname + url.search;
}

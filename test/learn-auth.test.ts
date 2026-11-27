import { GOOD_NEXT, HOSTILE_NEXT } from "./helpers/redirects.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/lib/migrate.ts";
import { hashPassword, verifyPassword } from "../src/lib/password.ts";
import { signIn } from "../src/lib/learn-signin.ts";
import {
  createSession,
  credentialFingerprint,
  destroySession,
  destroyUserSessions,
  LEARN_COOKIE_HOST,
  learnCookieName,
  lookupSession,
  SESSION_TTL_SECONDS,
} from "../src/lib/sessions.ts";
import { clearFailures, isLockedOut, recordFailure } from "../src/lib/throttle.ts";
import {
  addUser,
  authenticate,
  findUser,
  normalizeUsername,
  safeNext,
} from "../src/lib/users.ts";

const sql = (name: string): string =>
  readFileSync(new URL(`../src/migrations/${name}`, import.meta.url), "utf8");

/** The schema as the server builds it; 003 is a data step with no schema in it. */
function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, [sql("001_init.sql"), sql("002_summary.sql"), "", sql("004_users.sql"),
    sql("005_session_credential.sql"),
  ]);
  return db;
}

const NOW = 1_800_000_000;
const ADMIN = { username: "owner", passwordHash: hashPassword("the-owner-password") };
const BOOT = { username: "owner", credential: credentialFingerprint(ADMIN.passwordHash) };

test("004 adds users and the session scope, user and role", () => {
  const db = database();
  assert.deepEqual(
    (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
    ["id", "username", "password_hash", "role", "created_at", "disabled"],
  );
  const columns = (
    db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
  ).map((c) => c.name);
  for (const column of ["scope", "user_id", "role"])
    assert.ok(columns.includes(column), column);
});

test("the schema refuses a bad role, a capitalised name and a duplicate", () => {
  const db = database();
  const insert = (name: string, role: string) =>
    db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', ?, 1)",
      )
      .run(name, role);
  insert("ada", "friend");
  assert.throws(() => insert("ada", "friend"), /UNIQUE/);
  assert.throws(() => insert("Bob", "friend"), /CHECK/);
  assert.throws(() => insert("bob", "root"), /CHECK/);
  assert.throws(() => insert("bob", "Admin"), /CHECK/);
});

test("usernames are lower-case ASCII and nothing else", () => {
  assert.equal(normalizeUsername("  Ada.Lovelace "), "ada.lovelace");
  for (const bad of [
    "a",
    "",
    "x".repeat(33),
    "-ada",
    "ada lovelace",
    "adá",
    "ada/../x",
    "ａｄａ",
    null,
    5,
    {},
  ]) {
    assert.equal(normalizeUsername(bad), undefined, String(bad));
  }
});

test("a session only validates in its own scope", () => {
  const db = database();
  const id = addUser(db, {
    username: "ada",
    password: "pw-pw-pw-pw-1",
    role: "friend",
    now: NOW,
  });
  const learn = createSession(db, NOW, { scope: "learn", userId: id });
  const admin = createSession(db, NOW, {
    scope: "admin",
    role: "admin",
    credential: BOOT.credential,
  });

  assert.deepEqual(lookupSession(db, learn.token, "learn", NOW, BOOT), {
    username: "ada",
    role: "friend",
    userId: id,
  });
  assert.equal(
    lookupSession(db, learn.token, "admin", NOW, BOOT),
    undefined,
    "a learn token is worthless in the admin",
  );
  assert.deepEqual(lookupSession(db, admin.token, "admin", NOW, BOOT), {
    username: "owner",
    role: "admin",
    userId: null,
  });
  assert.equal(
    lookupSession(db, admin.token, "learn", NOW, BOOT),
    undefined,
    "an admin token is worthless on learn",
  );
});

test("a user's session cannot be an admin-scope session, even if one is forged into the table", () => {
  const db = database();
  const id = addUser(db, {
    username: "ada",
    password: "pw-pw-pw-pw-1",
    role: "admin",
    now: NOW,
  });
  const forged = createSession(db, NOW, { scope: "admin", userId: id });
  assert.equal(lookupSession(db, forged.token, "admin", NOW, BOOT), undefined);
});

test("a session without a user is the bootstrap admin only when its role says so", () => {
  const db = database();
  const none = createSession(db, NOW, { scope: "learn" });
  assert.equal(lookupSession(db, none.token, "learn", NOW, BOOT), undefined);
  const friend = createSession(db, NOW, { scope: "learn", role: "friend" });
  assert.equal(lookupSession(db, friend.token, "learn", NOW, BOOT), undefined);
});

test("sessions expire, are found by hash only, and can be destroyed", () => {
  const db = database();
  const id = addUser(db, {
    username: "ada",
    password: "pw-pw-pw-pw-1",
    role: "member",
    now: NOW,
  });
  const s = createSession(db, NOW, { scope: "learn", userId: id });
  assert.ok(lookupSession(db, s.token, "learn", NOW + SESSION_TTL_SECONDS - 1, BOOT));
  assert.equal(
    lookupSession(db, s.token, "learn", NOW + SESSION_TTL_SECONDS, BOOT),
    undefined,
  );
  const stored = (
    db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string }
  ).token_hash;
  assert.notEqual(stored, s.token);
  assert.equal(
    lookupSession(db, stored, "learn", NOW, BOOT),
    undefined,
    "the stored hash is not a token",
  );
  assert.equal(lookupSession(db, undefined, "learn", NOW, BOOT), undefined);
  assert.equal(lookupSession(db, "", "learn", NOW, BOOT), undefined);
  destroySession(db, s.token);
  assert.equal(lookupSession(db, s.token, "learn", NOW, BOOT), undefined);
});

test("a disabled account's sessions stop working at once, and a role change applies at once", () => {
  const db = database();
  const id = addUser(db, {
    username: "ada",
    password: "pw-pw-pw-pw-1",
    role: "friend",
    now: NOW,
  });
  const s = createSession(db, NOW, { scope: "learn", userId: id });
  db.prepare("UPDATE users SET role = 'member' WHERE id = ?").run(id);
  assert.equal(lookupSession(db, s.token, "learn", NOW, BOOT)?.role, "member");
  db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(id);
  assert.equal(
    lookupSession(db, s.token, "learn", NOW, BOOT),
    undefined,
    "disabled, though the row is still there",
  );
  db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(id);
  assert.ok(lookupSession(db, s.token, "learn", NOW, BOOT));
  destroyUserSessions(db, id);
  assert.equal(lookupSession(db, s.token, "learn", NOW, BOOT), undefined);
});

test("deleting an account deletes its sessions", () => {
  const db = database();
  const id = addUser(db, {
    username: "ada",
    password: "pw-pw-pw-pw-1",
    role: "friend",
    now: NOW,
  });
  createSession(db, NOW, { scope: "learn", userId: id });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  assert.equal(
    (db.prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }).n,
    0,
  );
});

test("authenticate: users, the bootstrap admin, and every way to fail", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  const off = addUser(db, {
    username: "off",
    password: "correct horse 2",
    role: "member",
    now: NOW,
  });
  db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(off);

  assert.deepEqual(await authenticate(db, ADMIN, "ada", "correct horse 1"), {
    username: "ada",
    role: "friend",
    userId: 1,
  });
  assert.equal(
    (await authenticate(db, ADMIN, "  ADA ", "correct horse 1"))?.username,
    "ada",
  );
  assert.deepEqual(await authenticate(db, ADMIN, "owner", "the-owner-password"), {
    username: "owner",
    role: "admin",
    userId: null,
  });
  assert.equal(
    (await authenticate(db, ADMIN, "OWNER", "the-owner-password"))?.role,
    "admin",
  );

  const failures = [
    await authenticate(db, ADMIN, "ada", "wrong"),
    await authenticate(db, ADMIN, "nobody", "correct horse 1"),
    await authenticate(db, ADMIN, "off", "correct horse 2"),
    await authenticate(db, ADMIN, "owner", "correct horse 1"),
    await authenticate(db, ADMIN, "", ""),
    await authenticate(db, ADMIN, null, null),
    await authenticate(db, ADMIN, "ada", "x".repeat(5000)),
    await authenticate(db, ADMIN, "not a name", "correct horse 1"),
    await authenticate(db, ADMIN, { toString: () => "ada" }, "correct horse 1"),
  ];
  assert.ok(failures.every((f) => f === undefined));
});

test("an unknown name costs about what a wrong password does (one key derivation each)", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  await authenticate(db, ADMIN, "ada", "warm"); // warm up the dummy hash
  const time = async (name: string): Promise<number> => {
    const start = performance.now();
    for (let i = 0; i < 4; i++) await authenticate(db, ADMIN, name, "wrong password");
    return performance.now() - start;
  };
  const known = await time("ada");
  const unknown = await time("nobody");
  const malformed = await time("not a name!");
  // Skipping the derivation would make these orders of magnitude faster, not 2x.
  assert.ok(
    unknown > known * 0.4,
    `unknown ${unknown.toFixed(0)}ms vs known ${known.toFixed(0)}ms`,
  );
  assert.ok(
    malformed > known * 0.4,
    `malformed ${malformed.toFixed(0)}ms vs known ${known.toFixed(0)}ms`,
  );
});

test("addUser stores a hash the server's own check accepts, and never the password", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  const row = findUser(db, "ada")!;
  assert.match(row.password_hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!row.password_hash.includes("correct horse"));
  assert.equal(await verifyPassword("correct horse 1", row.password_hash), true);
  assert.equal(await verifyPassword("correct horse 2", row.password_hash), false);
});

test("next is a path on this host and nothing else", () => {
  for (const [value, expected] of GOOD_NEXT) assert.equal(safeNext(value), expected, value);
  const nothing: unknown[] = [null, undefined, ["/x"], 42, {}, true, ""];
  for (const value of nothing) assert.equal(safeNext(value), "/", String(value));
  for (const value of HOSTILE_NEXT) {
    const out = safeNext(value);
    // Whatever comes out is one slash and a path: resolved against any host it stays there.
    assert.ok(/^\/(?![/\\])/.test(out), `${JSON.stringify(value)} -> ${out}`);
    assert.ok(!/[\\\u0000-\u001f\u007f]/.test(out), `${JSON.stringify(value)} -> ${out}`);
    assert.equal(new URL(out, "https://learn.example.com").origin, "https://learn.example.com");
    assert.equal(new URL(out, "https://learn.example.com").pathname.startsWith("//"), false);
    assert.ok(!/^\/sign(in|out)(\/|$)/i.test(out), `${JSON.stringify(value)} -> ${out}`);
  }
  // The review's own cases.
  for (const value of ["/..//evil.test", "/x/../..//evil.test", "/./\\evil.test", "//evil.test"]) {
    assert.equal(safeNext(value), "/", value);
  }
  // The helper returns the normalised path, never the raw input.
  assert.equal(safeNext("/a/%2e%2e/b"), "/b");
});

test("sign in: success makes a new session and kills the old one", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  const old = createSession(db, NOW, { scope: "learn", userId: 1 });
  const planted = "attacker-chosen-token";
  const result = await signIn({
    handle: db,
    now: NOW,
    bootstrap: ADMIN,
    ip: "203.0.113.1",
    username: "ada",
    password: "correct horse 1",
    oldToken: old.token,
  });
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.notEqual(result.token, old.token);
  assert.equal(
    lookupSession(db, old.token, "learn", NOW, BOOT),
    undefined,
    "the old session is gone",
  );
  assert.equal(lookupSession(db, planted, "learn", NOW, BOOT), undefined);
  assert.equal(lookupSession(db, result.token, "learn", NOW, BOOT)?.username, "ada");
  assert.equal(result.expiresAt, NOW + SESSION_TTL_SECONDS);
});

test("sign in: the bootstrap admin gets a learn session with no user row", async () => {
  const db = database();
  const result = await signIn({
    handle: db,
    now: NOW,
    bootstrap: ADMIN,
    ip: "203.0.113.2",
    username: "owner",
    password: "the-owner-password",
  });
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.deepEqual(lookupSession(db, result.token, "learn", NOW, BOOT), {
    username: "owner",
    role: "admin",
    userId: null,
  });
  assert.equal(
    lookupSession(db, result.token, "admin", NOW, BOOT),
    undefined,
    "and none for the admin site",
  );
});

test("sign in: failures are all alike, and five lock the address, and the name at that address, before any derivation", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  const attempt = (ip: string, username: string, password: string) =>
    signIn({ handle: db, now: NOW, bootstrap: ADMIN, ip, username, password });

  for (const [username, password] of [
    ["ada", "no"],
    ["nobody", "no"],
    ["", ""],
  ] as const) {
    assert.deepEqual(await attempt("198.51.100.9", username, password), {
      kind: "failed",
    });
    clearFailures("learn-ip:198.51.100.9");
    clearFailures(`learn-user:${username}`);
  }

  // Five wrong passwords from one address: the sixth is refused even with the right one.
  for (let i = 0; i < 5; i++)
    assert.equal((await attempt("198.51.100.10", "ada", "no")).kind, "failed");
  assert.equal((await attempt("198.51.100.10", "ada", "correct horse 1")).kind, "locked");
  assert.equal(
    (await attempt("198.51.100.10", "somebody-else", "x")).kind,
    "locked",
    "the address is locked for every name",
  );
  // The name alone is not locked: failures from one address never refuse another
  // address's correct password (see the next test).
  assert.equal((await attempt("198.51.100.11", "ada", "correct horse 1")).kind, "ok");
  // A name that does not exist is counted too, by name and address: the lockout says nothing about who is real.
  for (let i = 0; i < 5; i++) await attempt("198.51.100.20", "ghost", "no");
  assert.equal((await attempt("198.51.100.20", "ghost", "no")).kind, "locked");
  // Another name from another address is unaffected, and success clears the counts.
  assert.equal(
    (
      await signIn({
        handle: db,
        now: NOW,
        bootstrap: ADMIN,
        ip: "198.51.100.40",
        username: "owner",
        password: "the-owner-password",
      })
    ).kind,
    "ok",
  );
});

test("one address cannot lock a name out for everyone else (denial of service)", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  const attempt = (ip: string, username: string, password: string) =>
    signIn({ handle: db, now: NOW, bootstrap: ADMIN, ip, username, password });

  for (const [name, password] of [
    ["ada", "correct horse 1"],
    // The environment admin's name is the default target.
    ["owner", "the-owner-password"],
  ] as const) {
    // An attacker spreads wrong guesses over many addresses, and five on each.
    for (let a = 0; a < 20; a++) {
      for (let i = 0; i < 5; i++) await attempt(`203.0.113.${100 + a}`, name, "wrong");
    }
    // The one doing it is locked...
    assert.equal((await attempt("203.0.113.100", name, password)).kind, "locked");
    // ...but the real person, from an address of their own, is not.
    assert.equal((await attempt("198.51.100.77", name, password)).kind, "ok", name);
  }
});

test("a success clears what its address had counted against that name", async () => {
  const db = database();
  addUser(db, { username: "ada", password: "correct horse 1", role: "friend", now: NOW });
  const attempt = (ip: string, username: string, password: string) =>
    signIn({ handle: db, now: NOW, bootstrap: ADMIN, ip, username, password });
  for (let i = 0; i < 4; i++) await attempt("198.51.100.90", "ada", "wrong");
  // Success from this address clears what it had against that name.
  assert.equal((await attempt("198.51.100.90", "ada", "correct horse 1")).kind, "ok");
  for (let i = 0; i < 4; i++) await attempt("198.51.100.90", "ada", "wrong");
  assert.equal((await attempt("198.51.100.90", "ada", "correct horse 1")).kind, "ok");
});

test("the lockout ends, and the admin's and the lecture host's counts are separate", () => {
  for (let i = 0; i < 5; i++) recordFailure("203.0.113.50", NOW);
  assert.equal(isLockedOut("203.0.113.50", NOW + 10), true);
  assert.equal(isLockedOut("learn-ip:203.0.113.50", NOW + 10), false);
  assert.equal(isLockedOut("203.0.113.50", NOW + 15 * 60 + 1), false);
});

test("changing the environment admin's password ends its sessions, on both sites", async () => {
  const db = database();
  const learn = await signIn({
    handle: db,
    now: NOW,
    bootstrap: ADMIN,
    ip: "203.0.113.60",
    username: "owner",
    password: "the-owner-password",
  });
  assert.equal(learn.kind, "ok");
  if (learn.kind !== "ok") return;
  const admin = createSession(db, NOW, {
    scope: "admin",
    role: "admin",
    credential: BOOT.credential,
  });
  assert.ok(lookupSession(db, learn.token, "learn", NOW, BOOT));
  assert.ok(lookupSession(db, admin.token, "admin", NOW, BOOT));

  // The owner sets a new password: the configured hash changes (it has a new salt even if the words did not).
  const changed = {
    username: "owner",
    credential: credentialFingerprint(hashPassword("a-new-password")),
  };
  assert.notEqual(changed.credential, BOOT.credential);
  assert.equal(lookupSession(db, learn.token, "learn", NOW, changed), undefined);
  assert.equal(lookupSession(db, admin.token, "admin", NOW, changed), undefined);

  // A session made before this column existed has no fingerprint, and never validates.
  const old = createSession(db, NOW, { scope: "learn", role: "admin" });
  assert.equal(lookupSession(db, old.token, "learn", NOW, BOOT), undefined);

  // Signing in again under the new password works.
  const again = await signIn({
    handle: db,
    now: NOW,
    bootstrap: { username: "owner", passwordHash: hashPassword("a-new-password") },
    ip: "203.0.113.61",
    username: "owner",
    password: "a-new-password",
  });
  assert.equal(again.kind, "ok");
});

test("a user's session does not depend on the environment admin's password", () => {
  const db = database();
  const id = addUser(db, { username: "ada", password: "pw-pw-pw-pw-1", role: "friend", now: NOW });
  const s = createSession(db, NOW, { scope: "learn", userId: id });
  const changed = { username: "owner", credential: "something-else" };
  assert.equal(lookupSession(db, s.token, "learn", NOW, changed)?.username, "ada");
});

test("the lecture cookie is __Host- named on https and plain on http", () => {
  assert.equal(learnCookieName(new URL("https://learn.example.com/x")), "__Host-learn_session");
  assert.equal(learnCookieName(new URL("http://learn.localhost:4321/")), "learn_session");
  assert.equal(LEARN_COOKIE_HOST.startsWith("__Host-"), true);
});

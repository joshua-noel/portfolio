import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/lib/migrate.ts";
import { hashPassword, verifyPassword } from "../src/lib/password.ts";
import { signIn } from "../src/lib/learn-signin.ts";
import {
  createSession,
  destroySession,
  destroyUserSessions,
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
  migrate(db, [sql("001_init.sql"), sql("002_summary.sql"), "", sql("004_users.sql")]);
  return db;
}

const NOW = 1_800_000_000;
const ADMIN = { username: "owner", passwordHash: hashPassword("the-owner-password") };

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
  const admin = createSession(db, NOW, { scope: "admin", role: "admin" });

  assert.deepEqual(lookupSession(db, learn.token, "learn", NOW, "owner"), {
    username: "ada",
    role: "friend",
    userId: id,
  });
  assert.equal(
    lookupSession(db, learn.token, "admin", NOW, "owner"),
    undefined,
    "a learn token is worthless in the admin",
  );
  assert.deepEqual(lookupSession(db, admin.token, "admin", NOW, "owner"), {
    username: "owner",
    role: "admin",
    userId: null,
  });
  assert.equal(
    lookupSession(db, admin.token, "learn", NOW, "owner"),
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
  assert.equal(lookupSession(db, forged.token, "admin", NOW, "owner"), undefined);
});

test("a session without a user is the bootstrap admin only when its role says so", () => {
  const db = database();
  const none = createSession(db, NOW, { scope: "learn" });
  assert.equal(lookupSession(db, none.token, "learn", NOW, "owner"), undefined);
  const friend = createSession(db, NOW, { scope: "learn", role: "friend" });
  assert.equal(lookupSession(db, friend.token, "learn", NOW, "owner"), undefined);
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
  assert.ok(lookupSession(db, s.token, "learn", NOW + SESSION_TTL_SECONDS - 1, "owner"));
  assert.equal(
    lookupSession(db, s.token, "learn", NOW + SESSION_TTL_SECONDS, "owner"),
    undefined,
  );
  const stored = (
    db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string }
  ).token_hash;
  assert.notEqual(stored, s.token);
  assert.equal(
    lookupSession(db, stored, "learn", NOW, "owner"),
    undefined,
    "the stored hash is not a token",
  );
  assert.equal(lookupSession(db, undefined, "learn", NOW, "owner"), undefined);
  assert.equal(lookupSession(db, "", "learn", NOW, "owner"), undefined);
  destroySession(db, s.token);
  assert.equal(lookupSession(db, s.token, "learn", NOW, "owner"), undefined);
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
  assert.equal(lookupSession(db, s.token, "learn", NOW, "owner")?.role, "member");
  db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(id);
  assert.equal(
    lookupSession(db, s.token, "learn", NOW, "owner"),
    undefined,
    "disabled, though the row is still there",
  );
  db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(id);
  assert.ok(lookupSession(db, s.token, "learn", NOW, "owner"));
  destroyUserSessions(db, id);
  assert.equal(lookupSession(db, s.token, "learn", NOW, "owner"), undefined);
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
  const base = new URL("https://learn.example.com/signin?next=x");
  const ok = [
    "/",
    "/a/b",
    "/a/b?depth=deep",
    "/how-language-models-work/attention?x=1#frag",
  ];
  for (const value of ok) assert.equal(safeNext(value, base), value.replace(/#.*/, ""));
  const bad = [
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "http://learn.example.com/x",
    "javascript:alert(1)",
    "evil.example",
    "",
    "/signin",
    "/signin?next=/x",
    "/signout",
    "/signin/",
    "/\t/evil.example",
    "/%2F/evil.example",
    null,
    undefined,
    ["/x"],
    42,
  ];
  for (const value of bad) {
    const out = safeNext(value, base);
    assert.ok(
      out === "/" ||
        (out.startsWith("/") && !out.startsWith("//") && !out.includes("\\")),
      `${String(value)} -> ${out}`,
    );
  }
  assert.equal(safeNext("//evil.example", base), "/");
  assert.equal(safeNext("/\\evil.example", base), "/");
  assert.equal(safeNext("https://evil.example/", base), "/");
  assert.equal(safeNext("/signin", base), "/");
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
    lookupSession(db, old.token, "learn", NOW, "owner"),
    undefined,
    "the old session is gone",
  );
  assert.equal(lookupSession(db, planted, "learn", NOW, "owner"), undefined);
  assert.equal(lookupSession(db, result.token, "learn", NOW, "owner")?.username, "ada");
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
  assert.deepEqual(lookupSession(db, result.token, "learn", NOW, "owner"), {
    username: "owner",
    role: "admin",
    userId: null,
  });
  assert.equal(
    lookupSession(db, result.token, "admin", NOW, "owner"),
    undefined,
    "and none for the admin site",
  );
});

test("sign in: failures are all alike, and five lock the address and the name before any derivation", async () => {
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
  // The name is locked from every address, so a spread-out guess does not get five more tries each.
  assert.equal((await attempt("198.51.100.11", "ada", "correct horse 1")).kind, "locked");
  // A name that does not exist is counted too: the lockout says nothing about who is real.
  for (let i = 0; i < 5; i++) await attempt(`198.51.100.${20 + i}`, "ghost", "no");
  assert.equal((await attempt("198.51.100.30", "ghost", "no")).kind, "locked");
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

test("the lockout ends, and the admin's and the lecture host's counts are separate", () => {
  for (let i = 0; i < 5; i++) recordFailure("203.0.113.50", NOW);
  assert.equal(isLockedOut("203.0.113.50", NOW + 10), true);
  assert.equal(isLockedOut("learn-ip:203.0.113.50", NOW + 10), false);
  assert.equal(isLockedOut("203.0.113.50", NOW + 15 * 60 + 1), false);
});

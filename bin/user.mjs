#!/usr/bin/env node
// Accounts for the lecture site. There is no sign-up and no web page for
// this: the owner runs these on the machine that holds the database.
//
//   node bin/user.mjs add <username> --role friend|member|admin
//   node bin/user.mjs list
//   node bin/user.mjs set-role <username> --role friend|member|admin
//   node bin/user.mjs set-password <username>
//   node bin/user.mjs disable <username>
//   node bin/user.mjs enable <username>
//
// The password is read from a hidden prompt (asked twice) or, when input is
// piped, from standard input. It is never an argument: arguments end up in
// shell history and in process listings.
//
// The database is the server's: PORTFOLIO_DB_PATH, or portfolio.db in
// PORTFOLIO_STATE_DIR (default /var/lib/portfolio). The server creates and
// migrates it, so start the server once before the first command. Disabling
// an account, or changing its password, deletes its sessions at once.
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

const ROLES = ["admin", "friend", "member"];
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MIN_SCHEMA = 4; // the migration that adds `users`

// Same rule as src/lib/config.ts, duplicated because this file runs from a
// bare checkout and from the installed package, with no source tree beside it.
function env(name) {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, "utf8") : process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// Same scheme as src/lib/password.ts, as in bin/hash-password.mjs.
function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return [
    "scrypt",
    16384,
    8,
    1,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

function fail(message) {
  process.stderr.write(`user: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    [
      "usage:",
      "  user.mjs add <username> --role friend|member|admin",
      "  user.mjs list",
      "  user.mjs set-role <username> --role friend|member|admin",
      "  user.mjs set-password <username>",
      "  user.mjs disable <username>",
      "  user.mjs enable <username>",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

/** Splits `--role x` out of the arguments; refuses anything that would carry a password. */
function parse(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--role") flags.role = args[++i];
    else if (arg.startsWith("--role=")) flags.role = arg.slice("--role=".length);
    else if (arg.startsWith("-")) {
      fail(
        /pass/i.test(arg)
          ? "a password is never an argument; it is read from a hidden prompt or from standard input"
          : `unknown option ${arg}`,
      );
    } else positional.push(arg);
  }
  return { positional, flags };
}

function username(value) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!USERNAME.test(name)) {
    fail(
      `"${value ?? ""}" is not a username: 2 to 32 of a-z, 0-9, . _ - , starting with a letter or digit`,
    );
  }
  if (name === env("PORTFOLIO_ADMIN_USERNAME")?.toLowerCase()) {
    fail(
      `"${name}" is the environment admin's name; it signs in from its settings, not from an account`,
    );
  }
  return name;
}

function role(value) {
  if (!ROLES.includes(value)) fail(`--role is one of ${ROLES.join(", ")}`);
  return value;
}

async function readPassword(confirm) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const first = Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0];
    return first;
  }
  const ask = async (prompt) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    process.stderr.write(prompt);
    rl.output.write = () => {}; // suppress echo
    const answer = await new Promise((resolve) => rl.question("", resolve));
    rl.close();
    process.stderr.write("\n");
    return answer;
  };
  const first = await ask("Password: ");
  if (confirm && (await ask("Again: ")) !== first) fail("the two passwords differ");
  return first;
}

async function newPassword() {
  const password = await readPassword(true);
  if (password.length < 10) fail("use at least 10 characters");
  if (password.length > 1024) fail("at most 1024 characters");
  return hashPassword(password);
}

const [command, ...rest] = process.argv.slice(2);
if (!command) usage();
const { positional, flags } = parse(rest);

const dbPath =
  env("PORTFOLIO_DB_PATH") ??
  join(env("PORTFOLIO_STATE_DIR") ?? "/var/lib/portfolio", "portfolio.db");
if (!existsSync(dbPath)) {
  fail(
    `no database at ${dbPath}; start the server once so it creates it, or set PORTFOLIO_STATE_DIR`,
  );
}
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");
if (db.prepare("PRAGMA user_version").get().user_version < MIN_SCHEMA) {
  fail(
    "the database has not been migrated to the accounts schema; start the server once, then try again",
  );
}

const now = () => Math.floor(Date.now() / 1000);
const find = (name) => db.prepare("SELECT * FROM users WHERE username = ?").get(name);
const need = (name) => find(name) ?? fail(`no account called "${name}"`);

switch (command) {
  case "add": {
    const name = username(positional[0]);
    const chosen = role(flags.role);
    if (find(name)) fail(`"${name}" already exists`);
    const hash = await newPassword();
    db.prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    ).run(name, hash, chosen, now());
    console.log(`added ${name} (${chosen})`);
    break;
  }
  case "list": {
    const rows = db
      .prepare("SELECT username, role, created_at, disabled FROM users ORDER BY username")
      .all();
    if (rows.length === 0) console.log("no accounts");
    for (const row of rows) {
      const created = new Date(row.created_at * 1000).toISOString().slice(0, 10);
      console.log(
        `${row.username.padEnd(34)} ${row.role.padEnd(7)} ${created}${row.disabled ? "  disabled" : ""}`,
      );
    }
    break;
  }
  case "set-role": {
    const user = need(username(positional[0]));
    const chosen = role(flags.role);
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(chosen, user.id);
    console.log(`${user.username} is now ${chosen}`);
    break;
  }
  case "set-password": {
    const user = need(username(positional[0]));
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      await newPassword(),
      user.id,
    );
    const ended = db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .run(user.id).changes;
    console.log(`password changed for ${user.username}; ${ended} session(s) ended`);
    break;
  }
  case "disable": {
    const user = need(username(positional[0]));
    db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(user.id);
    const ended = db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .run(user.id).changes;
    console.log(`${user.username} disabled; ${ended} session(s) ended`);
    break;
  }
  case "enable": {
    const user = need(username(positional[0]));
    db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(user.id);
    console.log(`${user.username} enabled`);
    break;
  }
  default:
    usage();
}
db.close();

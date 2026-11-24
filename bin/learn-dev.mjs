#!/usr/bin/env node
// `pnpm learn:dev`: the dev server with the lecture host switched on, for a
// machine with no `just`, no bash and no DNS (PowerShell included).
//
//   site     http://localhost:4321
//   blog     http://blog.localhost:4321
//   lectures http://learn.localhost:4321
//
// Lectures come from PORTFOLIO_LEARN_CONTENT_DIRS or PORTFOLIO_LEARN_CONTENT_DIR
// if set, else the sample lectures in this repository. Everything else the
// server needs is made up here and kept in .data/ (never committed): a state
// directory, and a throwaway admin, `admin` / `dev`, whose hash is written on
// first run. Anything already set in the environment wins.
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = process.env.PORT ?? process.env.PORTFOLIO_PORT ?? "4321";
const data = join(root, ".data");
mkdirSync(data, { recursive: true });

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

const hashFile = join(data, "dev-password-hash");
if (!existsSync(hashFile)) {
  writeFileSync(hashFile, hashPassword("dev"));
  console.log("local admin credentials: admin / dev");
}

const env = {
  PORTFOLIO_SITE_URL: `http://localhost:${port}`,
  PORTFOLIO_BLOG_URL: `http://blog.localhost:${port}`,
  PORTFOLIO_LEARN_URL: `http://learn.localhost:${port}`,
  PORTFOLIO_STATE_DIR: data,
  PORTFOLIO_ADMIN_PASSWORD_HASH_FILE: hashFile,
  ...process.env,
};
if (!env.PORTFOLIO_LEARN_CONTENT_DIRS && !env.PORTFOLIO_LEARN_CONTENT_DIR) {
  env.PORTFOLIO_LEARN_CONTENT_DIR = join(root, "content", "learn");
}
// A hash file in the environment must not lose to a hash value left over there.
if (process.env.PORTFOLIO_ADMIN_PASSWORD_HASH)
  delete env.PORTFOLIO_ADMIN_PASSWORD_HASH_FILE;

console.log(`lectures:  ${env.PORTFOLIO_LEARN_URL}`);
console.log(
  `content:   ${env.PORTFOLIO_LEARN_CONTENT_DIRS ?? env.PORTFOLIO_LEARN_CONTENT_DIR}`,
);

const astro = join(
  dirname(createRequire(import.meta.url).resolve("astro/package.json")),
  "bin",
  "astro.mjs",
);
const child = spawn(
  process.execPath,
  [astro, "dev", "--host", "127.0.0.1", "--port", port],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

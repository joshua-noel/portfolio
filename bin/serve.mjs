#!/usr/bin/env node
// Launcher for the standalone Astro server.
//
// Two jobs the adapter cannot do itself:
//   1. @astrojs/node reads the generic HOST/PORT, so the prefixed names are
//      translated here rather than leaking two conventions into the NixOS
//      module.
//   2. Required configuration is checked before the socket opens, so a
//      missing secret is a startup failure in the journal instead of a 500
//      on the first request.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same rule as src/lib/config.ts, duplicated because this file runs before
// (and outside) the bundle it launches.
function cfg(name) {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, "utf8") : process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const missing = [
  "PORTFOLIO_SITE_URL",
  "PORTFOLIO_BLOG_URL",
  "PORTFOLIO_LEARN_URL",
  "PORTFOLIO_ADMIN_PASSWORD_HASH",
].filter((name) => cfg(name) === undefined);

if (missing.length > 0) {
  process.stderr.write(
    `missing required configuration: ${missing.map((n) => `${n} (or ${n}_FILE)`).join(", ")}\n`,
  );
  process.exit(78); // EX_CONFIG
}

// Serving `local` lectures is for the owner's own machine. Refuse before the
// socket opens if anything else could connect, and say so loudly if it is on.
if (cfg("PORTFOLIO_LEARN_ALLOW_LOCAL") === "1") {
  const host = cfg("PORTFOLIO_HOST") ?? "127.0.0.1";
  if (!(
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\./.test(host)
  )) {
    process.stderr.write(
      `PORTFOLIO_LEARN_ALLOW_LOCAL=1 refuses to run on ${host}: it serves local lectures to anyone who can connect\n`,
    );
    process.exit(78); // EX_CONFIG
  }
  process.stderr.write(
    "\n!!! PORTFOLIO_LEARN_ALLOW_LOCAL=1: local lectures are served to anyone who can reach this server. " +
      "For the owner's own machine only. !!!\n\n",
  );
}

// The sample lectures that ship in the package, unless a folder is named.
if (cfg("PORTFOLIO_LEARN_CONTENT_DIRS") === undefined && cfg("PORTFOLIO_LEARN_CONTENT_DIR") === undefined) {
  process.env.PORTFOLIO_LEARN_CONTENT_DIR = fileURLToPath(
    new URL("../content/learn", import.meta.url),
  );
}

process.env.HOST = cfg("PORTFOLIO_HOST") ?? "127.0.0.1";
process.env.PORT = cfg("PORTFOLIO_PORT") ?? "4321";

await import("../dist/server/entry.mjs");

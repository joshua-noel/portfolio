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

// This is the production server, and it never serves `local` lectures: they are
// for the owner's own machine under `pnpm learn:dev`. A switch that only
// looked at where the server listens could be fooled by a proxy on the same
// host, so there is no such switch here at all. (The bundle refuses it too:
// see loadConfig in src/lib/config.ts.)
if (cfg("PORTFOLIO_LEARN_ALLOW_LOCAL") === "1") {
  process.stderr.write(
    "PORTFOLIO_LEARN_ALLOW_LOCAL is refused by the production server: local lectures are " +
      "for your own machine only, under `pnpm learn:dev`. Unset it.\n",
  );
  process.exit(78); // EX_CONFIG
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

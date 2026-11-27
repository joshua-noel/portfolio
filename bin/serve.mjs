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
import http from "node:http";
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

// PORTFOLIO_LEARN_STEALTH (see src/lib/config.ts): unset, 0/off, 1/on or private. A typo
// refuses to start rather than leave the lecture host more public than meant.
const stealth = (cfg("PORTFOLIO_LEARN_STEALTH") ?? "off").toLowerCase();
if (!["0", "off", "1", "on", "private"].includes(stealth)) {
  process.stderr.write("PORTFOLIO_LEARN_STEALTH must be unset, 0, 1 or private\n");
  process.exit(78); // EX_CONFIG
}
const stealthOn = stealth !== "0" && stealth !== "off";

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

// Responses the framework sends before the middleware runs (a trailing-slash
// redirect, a static file under /_astro, a method it refuses) never pass
// through `seal` in src/middleware.ts, and nothing in the bundle can reach
// them. So the server's request listener is wrapped here: for the lecture
// host, a floor of headers is set on the response first. The middleware's own
// values replace these on everything it answers (the full policy, and a
// route's own cache-control), and static files keep their own caching.
//
// Not covered: a request Node's HTTP parser refuses (an unknown method such as
// FOO, a malformed request line) is answered before any listener runs, and
// before the Host header is known; it carries no content.
const learnHost = new URL(cfg("PORTFOLIO_LEARN_URL")).host;
const FLOOR = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};
if (stealthOn) FLOOR["X-Robots-Tag"] = "noindex, nofollow, noarchive";
const createServer = http.createServer;
http.createServer = (...args) => {
  const at = args.findIndex((arg) => typeof arg === "function");
  if (at !== -1) {
    const listener = args[at];
    args[at] = (req, res) => {
      if (req.headers.host === learnHost) {
        for (const [name, value] of Object.entries(FLOOR)) res.setHeader(name, value);
      }
      return listener(req, res);
    };
  }
  return createServer.apply(http, args);
};

await import("../dist/server/entry.mjs");

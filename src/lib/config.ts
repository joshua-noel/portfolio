import { readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

export type Env = Record<string, string | undefined>;

/**
 * `FOO_FILE` wins over `FOO`, uniformly for every variable rather than only
 * for secrets. One rule means there is no table of which names are "secret"
 * to keep in sync, and it costs the same five lines either way. The file
 * form is what sops-nix and systemd's LoadCredential produce.
 */
export function readEnv(name: string, env: Env = process.env): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) {
    const value = readFileSync(file, "utf8").trim();
    return value === "" ? undefined : value;
  }
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export interface Config {
  host: string;
  port: number;
  stateDir: string;
  /**
   * Folders of courses, laid out as learn-content/CONTRACT.md says, merged.
   * Only the sample folder in the repository holds public content alone;
   * private folders are read here, at run time, and nowhere else.
   */
  learnContentDirs: string[];
  /**
   * Serve `local` lectures. For the owner's own machine only, and only under
   * `astro dev`: refused unless the learn URL is itself a localhost origin and
   * this is the dev server, never the built server. Each request is then
   * checked again (`mayServeLocal`). The NixOS module has no option for it.
   */
  learnAllowLocal: boolean;
  dbPath: string;
  uploadsDir: string;
  siteUrl: string;
  blogUrl: string;
  learnUrl: string;
  /** The stealth release switch (PORTFOLIO_LEARN_STEALTH): see `parseStealth`. */
  learnStealth: Stealth;
  siteHost: string;
  blogHost: string;
  learnHost: string;
  adminUsername: string;
  adminPasswordHash: string;
  /** Proxy addresses, beyond loopback, whose X-Forwarded-For is believed. */
  trustedProxies: string[];
  /**
   * How many reverse proxies stand between a visitor and this process, each
   * appending the address it saw to X-Forwarded-For. 0 ignores forwarded
   * headers altogether; the default, 1, is one proxy on this host.
   */
  trustedProxyHops: number;
}

/** True for `localhost` and `*.localhost`, which no resolver sends off the machine. */
export const isLocalhostName = (hostname: string): boolean =>
  hostname === "localhost" || hostname.endsWith(".localhost");

export interface LoadOptions {
  /**
   * Whether this is the dev server. The default reads a flag the bundler
   * fixes when it builds: false in `dist/server/entry.mjs`, whatever the
   * environment says, and absent (so false) under plain Node.
   */
  devServer?: boolean;
}

const isLoopbackHost = (host: string): boolean =>
  host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);

/**
 * PORTFOLIO_LEARN_CONTENT_DIRS is a list separated like PATH (`;` on Windows,
 * `:` elsewhere); PORTFOLIO_LEARN_CONTENT_DIR names one; with neither, the
 * sample lectures in the repository.
 */
function contentDirs(env: Env): string[] {
  const list = readEnv("PORTFOLIO_LEARN_CONTENT_DIRS", env);
  const one = readEnv("PORTFOLIO_LEARN_CONTENT_DIR", env);
  const dirs = list
    ? list.split(delimiter).filter((dir) => dir.trim() !== "")
    : [one ?? "content/learn"];
  return dirs.map((dir) => resolve(dir.trim()));
}

/**
 * PORTFOLIO_LEARN_STEALTH: the "stealth release" switch, read once at start.
 * Unset, `0` or `off` is today's behaviour. `1` or `on` keeps the lecture host
 * out of search engines and out of every sitemap and link of the other two
 * (discoverability control, NOT access control). `private` is that plus a
 * signed-in account for every lecture page. Anything else refuses to start, so
 * a typo cannot leave the site more public than meant.
 */
export type Stealth = "off" | "on" | "private";

export function parseStealth(value: string | undefined): Stealth {
  const v = value?.trim().toLowerCase();
  if (v === undefined || v === "" || v === "0" || v === "off") return "off";
  if (v === "1" || v === "on") return "on";
  if (v === "private") return "private";
  throw new Error(`PORTFOLIO_LEARN_STEALTH must be unset, 0, 1 or private (got "${value}")`);
}

export function loadConfig(
  env: Env = process.env,
  { devServer = import.meta.env?.DEV === true }: LoadOptions = {},
): Config {
  const missing: string[] = [];
  const require_ = (name: string): string => {
    const value = readEnv(name, env);
    if (value === undefined) missing.push(name);
    return value ?? "";
  };

  const stateDir = readEnv("PORTFOLIO_STATE_DIR", env) ?? "/var/lib/portfolio";
  const siteUrl = require_("PORTFOLIO_SITE_URL");
  const blogUrl = require_("PORTFOLIO_BLOG_URL");
  const learnUrl = require_("PORTFOLIO_LEARN_URL");
  const adminPasswordHash = require_("PORTFOLIO_ADMIN_PASSWORD_HASH");

  if (missing.length > 0) {
    throw new Error(
      `missing required configuration: ${missing
        .map((n) => `${n} (or ${n}_FILE)`)
        .join(", ")}`,
    );
  }

  const host = readEnv("PORTFOLIO_HOST", env) ?? "127.0.0.1";
  const learnAllowLocal = readEnv("PORTFOLIO_LEARN_ALLOW_LOCAL", env) === "1";
  if (learnAllowLocal) {
    const refuse = (why: string): never => {
      throw new Error(
        "PORTFOLIO_LEARN_ALLOW_LOCAL=1 serves local lectures to anyone who can reach the " +
          `server, so it refuses to run: ${why}. It is for the owner's own machine, under \`pnpm learn:dev\`.`,
      );
    };
    // The anchor, and it cannot be fooled by a proxy: a server that answers
    // for a real hostname is not the owner's own machine.
    if (!isLocalhostName(new URL(learnUrl).hostname)) {
      refuse(`PORTFOLIO_LEARN_URL (${learnUrl}) is not a localhost address`);
    }
    if (!devServer) refuse("this is not the dev server");
    if (!isLoopbackHost(host)) refuse(`it would listen on ${host}, not loopback`);
  }
  const hops = Number(readEnv("PORTFOLIO_TRUSTED_PROXY_HOPS", env) ?? "1");
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error("PORTFOLIO_TRUSTED_PROXY_HOPS must be a whole number from 0 to 10");
  }

  return {
    host,
    port: Number(readEnv("PORTFOLIO_PORT", env) ?? "4321"),
    stateDir,
    learnContentDirs: contentDirs(env),
    learnAllowLocal,
    learnStealth: parseStealth(readEnv("PORTFOLIO_LEARN_STEALTH", env)),
    dbPath: readEnv("PORTFOLIO_DB_PATH", env) ?? join(stateDir, "portfolio.db"),
    uploadsDir: readEnv("PORTFOLIO_UPLOADS_DIR", env) ?? join(stateDir, "uploads"),
    siteUrl: siteUrl.replace(/\/+$/, ""),
    blogUrl: blogUrl.replace(/\/+$/, ""),
    learnUrl: learnUrl.replace(/\/+$/, ""),
    siteHost: new URL(siteUrl).host,
    blogHost: new URL(blogUrl).host,
    learnHost: new URL(learnUrl).host,
    adminUsername: readEnv("PORTFOLIO_ADMIN_USERNAME", env) ?? "admin",
    adminPasswordHash,
    trustedProxies: (readEnv("PORTFOLIO_TRUSTED_PROXIES", env) ?? "")
      .split(/[\s,]+/)
      .filter(Boolean),
    trustedProxyHops: hops,
  };
}

let cached: Config | undefined;

/**
 * Memoised rather than evaluated at import time: `astro build` imports every
 * module, and a build should never need production secrets to succeed.
 */
export function getConfig(): Config {
  if (!cached) {
    cached = loadConfig();
    if (cached.learnAllowLocal) {
      console.warn(
        "\n!!! PORTFOLIO_LEARN_ALLOW_LOCAL=1: `local` lectures are served to requests from this machine's " +
          "loopback with no proxy headers. This is for the owner's own machine. Never set it on a server. !!!\n",
      );
    }
  }
  return cached;
}

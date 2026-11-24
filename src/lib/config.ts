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
   * Serve `local` lectures. For the owner's own machine only: refused unless
   * the server listens on loopback, and the NixOS module has no option for it.
   */
  learnAllowLocal: boolean;
  dbPath: string;
  uploadsDir: string;
  siteUrl: string;
  blogUrl: string;
  learnUrl: string;
  siteHost: string;
  blogHost: string;
  learnHost: string;
  adminUsername: string;
  adminPasswordHash: string;
  /** Proxy addresses, beyond loopback, whose X-Forwarded-For is believed. */
  trustedProxies: string[];
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

export function loadConfig(env: Env = process.env): Config {
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
  if (learnAllowLocal && !isLoopbackHost(host)) {
    throw new Error(
      "PORTFOLIO_LEARN_ALLOW_LOCAL=1 serves local lectures to anyone who can connect, " +
        `so it refuses to run on ${host}: it is for the owner's own machine, on loopback`,
    );
  }

  return {
    host,
    port: Number(readEnv("PORTFOLIO_PORT", env) ?? "4321"),
    stateDir,
    learnContentDirs: contentDirs(env),
    learnAllowLocal,
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
        "\n!!! PORTFOLIO_LEARN_ALLOW_LOCAL=1: `local` lectures are being served to ANYONE who can " +
          "reach this server. This is for the owner's own machine. Never set it on a server. !!!\n",
      );
    }
  }
  return cached;
}

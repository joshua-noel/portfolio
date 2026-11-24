import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { hashPassword } from "../../src/lib/password.ts";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const astro = join(
  dirname(createRequire(import.meta.url).resolve("astro/package.json")),
  "bin",
  "astro.mjs",
);

export const OWNER = { username: "owner", password: "the-owner-password" };

/**
 * Builds the site once into a throwaway directory, with the content folders in
 * the environment as they would be in production, and returns where it went.
 * Only a build with the private folders configured proves that nothing in them
 * is baked into the output.
 */
export function build(env: Record<string, string>): string {
  const base = mkdtempSync(join(tmpdir(), "portfolio-build-"));
  const out = join(base, "dist");
  // Astro resolves --config against the project, so the file goes inside it
  // (in .data/, which is never committed) and is named relative to it.
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  const config = join(ROOT, ".data", `astro.test.${process.pid}.mjs`);
  writeFileSync(
    config,
    `import base from ${JSON.stringify(pathToFileURL(join(ROOT, "astro.config.mjs")).href)};\n` +
      `export default { ...base, outDir: ${JSON.stringify(out)} };\n`,
  );
  const result = spawnSync(
    process.execPath,
    [astro, "build", "--config", relative(ROOT, config)],
    {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
  rmSync(config, { force: true });
  if (result.status !== 0)
    throw new Error(`astro build failed:\n${result.stdout}\n${result.stderr}`);
  return out;
}

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });

export interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  cookies: string[];
}

export interface Server {
  port: number;
  stateDir: string;
  /** What the process wrote to standard error. */
  stderr: () => string;
  stop: () => Promise<void>;
  request: (
    host: "site" | "blog" | "learn",
    method: string,
    path: string,
    options?: {
      cookie?: string;
      headers?: Record<string, string>;
      form?: Record<string, string>;
      origin?: string | null;
    },
  ) => Promise<Response>;
  /** Runs bin/user.mjs against this server's database. */
  user: (
    args: string[],
    options?: { password?: string; env?: Record<string, string> },
  ) => { status: number; stdout: string; stderr: string };
}

const HOSTS = { site: "site.test", blog: "blog.test", learn: "learn.test" } as const;

export async function start(options: {
  out: string;
  contentDirs: string[];
  env?: Record<string, string>;
  /** Reuse a state directory (the database and its sessions) from an earlier server. */
  stateDir?: string;
  /**
   * Start through bin/serve.mjs, the way production does, instead of the
   * bundle's entry. The launcher is copied next to the build (it imports
   * ../dist/server/entry.mjs), so the test's own build is what it runs.
   */
  viaLauncher?: boolean;
  /** Ready on any answer, even a 500: for a server that is meant to refuse its configuration. */
  anyAnswer?: boolean;
}): Promise<Server> {
  const port = await freePort();
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "portfolio-state-"));
  mkdirSync(stateDir, { recursive: true });
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOST: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "production",
    PORTFOLIO_SITE_URL: "https://site.test",
    PORTFOLIO_BLOG_URL: "https://blog.test",
    PORTFOLIO_LEARN_URL: "https://learn.test",
    PORTFOLIO_STATE_DIR: stateDir,
    PORTFOLIO_ADMIN_USERNAME: OWNER.username,
    PORTFOLIO_ADMIN_PASSWORD_HASH: hashPassword(OWNER.password),
    PORTFOLIO_LEARN_CONTENT_DIRS: options.contentDirs.join(
      process.platform === "win32" ? ";" : ":",
    ),
    ...options.env,
  };
  delete env.PORTFOLIO_LEARN_CONTENT_DIR;
  // The owner's own shell may have these set; a test server has what the test gives it.
  for (const name of [
    "PORTFOLIO_LEARN_ALLOW_LOCAL",
    "PORTFOLIO_TRUSTED_PROXIES",
    "PORTFOLIO_TRUSTED_PROXY_HOPS",
    "PORTFOLIO_HOST",
    "PORTFOLIO_DB_PATH",
  ]) {
    if (options.env?.[name] === undefined) delete env[name];
  }

  let entry = join(options.out, "server", "entry.mjs");
  if (options.viaLauncher) {
    env.PORTFOLIO_HOST = "127.0.0.1";
    env.PORTFOLIO_PORT = String(port);
    const bin = join(dirname(options.out), "bin");
    mkdirSync(bin, { recursive: true });
    entry = join(bin, "serve.mjs");
    copyFileSync(join(ROOT, "bin", "serve.mjs"), entry);
  }

  let stderr = "";
  const child: ChildProcess = spawn(
    process.execPath,
    [entry],
    {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
  child.stdout!.resume();
  let exited = false;
  child.on("exit", () => (exited = true));

  const send: Server["request"] = (host, method, path, opts = {}) =>
    new Promise((resolve, reject) => {
      const body = opts.form ? new URLSearchParams(opts.form).toString() : undefined;
      const headers: Record<string, string> = {
        host: HOSTS[host],
        "x-forwarded-proto": "https",
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.origin === undefined || opts.origin === null
          ? {}
          : { origin: opts.origin }),
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/x-www-form-urlencoded",
              "content-length": String(Buffer.byteLength(body)),
            }),
        ...opts.headers,
      };
      const req = httpRequest(
        // A new connection each time: Node reuses idle sockets, and under load a server
        // that has just closed one makes the next request fail with ECONNRESET.
        { host: "127.0.0.1", port, method, path, headers, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text: Buffer.concat(chunks).toString("utf8"),
              cookies: (res.headers["set-cookie"] ?? []) as string[],
            }),
          );
        },
      );
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });

  // Ready when it answers; a process that died says why.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (exited) throw new Error(`server exited early:\n${stderr}`);
    try {
      const res = await send("site", "GET", "/healthz");
      if (res.status === 200 || options.anyAnswer) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The database is made when it is first used: use it, so tools can find it.
  if (!options.anyAnswer) await send("blog", "GET", "/");

  return {
    port,
    stateDir,
    stderr: () => stderr,
    request: send,
    stop: () =>
      new Promise((resolve) => {
        if (exited) return resolve();
        child.on("exit", () => resolve());
        child.kill();
      }),
    user: (args, o = {}) => {
      const result = spawnSync(
        process.execPath,
        [join(ROOT, "bin", "user.mjs"), ...args],
        {
          env: { ...process.env, PORTFOLIO_STATE_DIR: stateDir, ...o.env },
          input: o.password === undefined ? "" : `${o.password}\n`,
          encoding: "utf8",
        },
      );
      return {
        status: result.status ?? -1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
}

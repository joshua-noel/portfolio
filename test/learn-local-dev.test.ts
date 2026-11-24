import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT, freePort } from "./helpers/server.ts";
import { hashPassword } from "../src/lib/password.ts";
import { SECRET, visibilityLibrary, writeLibrary } from "./helpers/fixtures.ts";

/**
 * The one place `local` lectures are served: the owner's own machine, under
 * the dev server, to a loopback peer with no sign of a proxy. This starts the
 * dev server (as `pnpm learn:dev` does) and asks it.
 */
if (process.env.PORTFOLIO_SKIP_E2E) process.exit(0);

const astro = join(
  dirname(createRequire(import.meta.url).resolve("astro/package.json")),
  "bin",
  "astro.mjs",
);

const library = mkdtempSync(join(tmpdir(), "portfolio-local-library-"));
writeLibrary(library, visibilityLibrary());

let port = 0;
let child: ChildProcess;
let stderr = "";

const get = (
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        headers: { host: `learn.localhost:${port}`, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

before(async () => {
  port = await freePort();
  child = spawn(
    process.execPath,
    [astro, "dev", "--ignore-lock", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORTFOLIO_SITE_URL: `http://localhost:${port}`,
        PORTFOLIO_BLOG_URL: `http://blog.localhost:${port}`,
        PORTFOLIO_LEARN_URL: `http://learn.localhost:${port}`,
        PORTFOLIO_STATE_DIR: mkdtempSync(join(tmpdir(), "portfolio-local-state-")),
        PORTFOLIO_ADMIN_PASSWORD_HASH: hashPassword("dev"),
        PORTFOLIO_LEARN_CONTENT_DIRS: library,
        PORTFOLIO_LEARN_ALLOW_LOCAL: "1",
        // Under an AI agent Astro would detach the server into the background,
        // out of this process's reach; this keeps it a child that is stopped below.
        ASTRO_DEV_BACKGROUND: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout!.resume();
  child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await get("/healthz")).status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`dev server did not start:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

after(() => {
  if (!child?.pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill();
});

test("on the dev server, from loopback with no proxy header, a local lecture is served", async () => {
  for (const path of ["/c-local/l-local", "/c-local", "/media/c-local/01-l-local.mp4"]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
  }
  assert.ok((await get("/c-local/l-local")).text.includes(SECRET.local));
  assert.ok((await get(`/search.json?q=${SECRET.local}`)).text.includes("l-local"));
});

test("any sign of a proxy takes it away again", async () => {
  const proxied: Record<string, string>[] = [
    { "x-forwarded-for": "203.0.113.9" },
    { forwarded: "for=203.0.113.9" },
    { via: "1.1 proxy" },
    { "x-real-ip": "203.0.113.9" },
    { "x-forwarded-proto": "https" },
  ];
  for (const headers of proxied) {
    const res = await get("/c-local/l-local", headers);
    assert.equal(res.status, 404, JSON.stringify(headers));
    assert.ok(!res.text.includes(SECRET.local), JSON.stringify(headers));
    const search = await get(`/search.json?q=${SECRET.local}`, headers);
    assert.ok(!search.text.includes("l-local"), JSON.stringify(headers));
  }
});

test("a proxy header on one request does not leak into the next one", async () => {
  await get("/c-local/l-local", { "x-forwarded-for": "203.0.113.9" });
  assert.equal((await get("/c-local/l-local")).status, 200);
});

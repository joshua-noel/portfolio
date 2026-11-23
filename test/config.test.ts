import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, readEnv } from "../src/lib/config.ts";

const dir = mkdtempSync(join(tmpdir(), "portfolio-config-"));

const base = {
  PORTFOLIO_SITE_URL: "https://example.com",
  PORTFOLIO_BLOG_URL: "https://blog.example.com",
  PORTFOLIO_LEARN_URL: "https://learn.example.com",
  PORTFOLIO_ADMIN_PASSWORD_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
};

test("reads a plain variable", () => {
  assert.equal(readEnv("X", { X: "value" }), "value");
});

test("_FILE wins over the inline value", () => {
  const path = join(dir, "secret");
  writeFileSync(path, "from-file\n");
  assert.equal(readEnv("X", { X: "inline", X_FILE: path }), "from-file");
});

test("blank values read as absent", () => {
  assert.equal(readEnv("X", { X: "   " }), undefined);
  assert.equal(readEnv("X", {}), undefined);
});

test("missing required variables are all named at once", () => {
  assert.throws(
    () => loadConfig({}),
    (error: Error) =>
      error.message.includes("PORTFOLIO_SITE_URL (or PORTFOLIO_SITE_URL_FILE)") &&
      error.message.includes("PORTFOLIO_BLOG_URL") &&
      error.message.includes("PORTFOLIO_LEARN_URL") &&
      error.message.includes("PORTFOLIO_ADMIN_PASSWORD_HASH"),
  );
});

test("derives paths from the state directory", () => {
  const config = loadConfig({ ...base, PORTFOLIO_STATE_DIR: "/srv/state" });
  assert.equal(config.dbPath, "/srv/state/portfolio.db");
  assert.equal(config.uploadsDir, "/srv/state/uploads");
});

test("strips trailing slashes and extracts hosts", () => {
  const config = loadConfig({
    ...base,
    PORTFOLIO_SITE_URL: "https://example.com/",
    PORTFOLIO_BLOG_URL: "https://blog.example.com//",
    PORTFOLIO_LEARN_URL: "https://learn.example.com/",
  });
  assert.equal(config.siteUrl, "https://example.com");
  assert.equal(config.blogUrl, "https://blog.example.com");
  assert.equal(config.learnUrl, "https://learn.example.com");
  assert.equal(config.siteHost, "example.com");
  assert.equal(config.blogHost, "blog.example.com");
  assert.equal(config.learnHost, "learn.example.com");
});

test("defaults host, port and admin username", () => {
  const config = loadConfig(base);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4321);
  assert.equal(config.adminUsername, "admin");
});

test("the lecture folder defaults to the sample lectures and can be named", () => {
  assert.equal(loadConfig(base).learnContentDir, resolve("content/learn"));
  const named = loadConfig({ ...base, PORTFOLIO_LEARN_CONTENT_DIR: "/srv/learn-content" });
  assert.equal(named.learnContentDir, resolve("/srv/learn-content"));
});

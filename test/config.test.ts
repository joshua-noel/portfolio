import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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
  assert.equal(config.dbPath, join("/srv/state", "portfolio.db"));
  assert.equal(config.uploadsDir, join("/srv/state", "uploads"));
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

test("the lecture folders default to the sample lectures and can be named", () => {
  assert.deepEqual(loadConfig(base).learnContentDirs, [resolve("content/learn")]);
  assert.deepEqual(
    loadConfig({ ...base, PORTFOLIO_LEARN_CONTENT_DIR: "/srv/one" }).learnContentDirs,
    [resolve("/srv/one")],
  );
  const several = ["/srv/a", "/srv/b"].join(delimiter);
  assert.deepEqual(
    loadConfig({
      ...base,
      PORTFOLIO_LEARN_CONTENT_DIRS: several,
      PORTFOLIO_LEARN_CONTENT_DIR: "/x",
    }).learnContentDirs,
    [resolve("/srv/a"), resolve("/srv/b")],
  );
});

const dev = { devServer: true };
const local = {
  ...base,
  PORTFOLIO_LEARN_URL: "http://learn.localhost:4321",
  PORTFOLIO_LEARN_ALLOW_LOCAL: "1",
};

test("serving local lectures needs an explicit 1", () => {
  assert.equal(loadConfig(base).learnAllowLocal, false);
  assert.equal(
    loadConfig({ ...local, PORTFOLIO_LEARN_ALLOW_LOCAL: "true" }, dev).learnAllowLocal,
    false,
  );
  assert.equal(loadConfig(local, dev).learnAllowLocal, true);
});

test("the local switch is refused unless the learn URL is a localhost origin", () => {
  // The bare-proxy case: a real hostname, the switch on, requests that will
  // all arrive from loopback with no forwarded headers. It must not start.
  for (const url of [
    "https://learn.example.com",
    "http://learn.localhost.example.com",
    "http://notlocalhost",
    "http://localhost.evil.test",
    "http://127.0.0.1:4321",
    "http://localhost.:4321",
  ]) {
    assert.throws(
      () => loadConfig({ ...local, PORTFOLIO_LEARN_URL: url }, dev),
      /not a localhost address/,
      url,
    );
  }
  for (const url of [
    "http://localhost:4321",
    "http://learn.localhost:4321",
    "https://a.b.localhost",
  ]) {
    assert.equal(
      loadConfig({ ...local, PORTFOLIO_LEARN_URL: url }, dev).learnAllowLocal,
      true,
    );
  }
});

test("the local switch is refused outside the dev server, whatever the environment says", () => {
  assert.throws(() => loadConfig(local), /not the dev server/);
  assert.throws(() => loadConfig(local, { devServer: false }), /not the dev server/);
  assert.throws(
    () => loadConfig({ ...local, NODE_ENV: "development", DEV: "true" }),
    /not the dev server/,
  );
});

test("the local switch is refused when the server would listen beyond loopback", () => {
  assert.throws(
    () => loadConfig({ ...local, PORTFOLIO_HOST: "0.0.0.0" }, dev),
    /not loopback/,
  );
  assert.equal(loadConfig({ ...local, PORTFOLIO_HOST: "::1" }, dev).learnAllowLocal, true);
});

test("trusted proxy hops default to one, and must be a small whole number", () => {
  assert.equal(loadConfig(base).trustedProxyHops, 1);
  assert.equal(
    loadConfig({ ...base, PORTFOLIO_TRUSTED_PROXY_HOPS: "0" }).trustedProxyHops,
    0,
  );
  assert.equal(
    loadConfig({ ...base, PORTFOLIO_TRUSTED_PROXY_HOPS: "2" }).trustedProxyHops,
    2,
  );
  for (const bad of ["-1", "1.5", "many", "11"]) {
    assert.throws(
      () => loadConfig({ ...base, PORTFOLIO_TRUSTED_PROXY_HOPS: bad }),
      /PORTFOLIO_TRUSTED_PROXY_HOPS/,
      bad,
    );
  }
});

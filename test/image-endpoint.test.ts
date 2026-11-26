import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, start, type Server } from "./helpers/server.ts";
import { visibilityLibrary, writeLibrary } from "./helpers/fixtures.ts";

/**
 * Astro answers `/_image` on every host and, in a stock build, serves files from
 * dist/client through it. The site uses no astro:assets, so the endpoint is
 * replaced (src/image-endpoint.ts) and the middleware sends what still reaches
 * it to the 404 page. Every way of asking is tried on a real build.
 */
if (process.env.PORTFOLIO_SKIP_E2E) process.exit(0);

const library = mkdtempSync(join(tmpdir(), "portfolio-image-library-"));
writeLibrary(library, visibilityLibrary());

let out: string;
let server: Server;
/** A file the stock endpoint would have served, and a string only it contains. */
let asset: string;
let assetText: string;

before(async () => {
  out = build({ PORTFOLIO_LEARN_CONTENT_DIRS: library });
  server = await start({ out, contentDirs: [library] });
  const css = readdirSync(join(out, "client", "_astro")).find((name) =>
    name.endsWith(".css"),
  )!;
  asset = `/_astro/${css}`;
  assetText = readFileSync(join(out, "client", "_astro", css), "utf8");
  assert.ok(assetText.length > 1000);
});

after(async () => {
  await server?.stop();
});

const HOSTS = ["site", "blog", "learn"] as const;

const paths = (): string[] => {
  const href = encodeURIComponent(asset);
  return [
    `/_image?href=${asset}&w=1&f=png`,
    `/_image?href=${asset}`,
    `/_image?href=${href}&f=svg`,
    `/_image?href=${asset}&href=/etc/passwd`,
    `/_image?href=/../server/entry.mjs`,
    `/_image?href=file:///C:/Windows/win.ini`,
    `/_image?href=https://example.com/a.png&f=webp`,
    "/_image",
    "/_image/",
    "/_image/x",
    "/_image?",
    "/_image?%00",
    `/%5Fimage?href=${asset}`,
    `/%5fimage?href=${asset}`,
    `//_image?href=${asset}`,
    `///_image?href=${asset}`,
    `/./_image?href=${asset}`,
    `/x/../_image?href=${asset}`,
    `/_image/.?href=${asset}`,
    `/_image%2f?href=${asset}`,
    `/_image%00?href=${asset}`,
    `/_image;a=b?href=${asset}`,
    `/_image#x`,
    `/_Image?href=${asset}`,
    `/_IMAGE?href=${asset}`,
  ];
};

const FORWARDED: Record<string, Record<string, string>> = {
  none: {},
  "forwarded host, learn": { "x-forwarded-host": "learn.test" },
  "forwarded host and proto, blog": {
    "x-forwarded-host": "blog.test",
    "x-forwarded-proto": "http",
  },
  "forwarded, learn": { forwarded: "host=learn.test;proto=https" },
  "forwarded port": { "x-forwarded-port": "443" },
  "an unknown host": { host: "images.example.test" },
};

test("/_image and its variants answer the 404 page on every host, and serve no file", async () => {
  for (const host of HOSTS) {
    for (const [how, headers] of Object.entries(FORWARDED)) {
      for (const path of paths()) {
        const where = `${host} ${how} ${path}`;
        const res = await server.request(host, "GET", path, { headers });
        assert.equal(res.status, 404, where);
        assert.match(String(res.headers["content-type"]), /^text\/html/, where);
        assert.ok(!/^image\//.test(String(res.headers["content-type"])), where);
        assert.ok(res.text.includes("<html"), `${where}: the 404 page`);
        // Nothing of any file (a 404 page may print the path it was asked for), nor of an error.
        assert.ok(!res.text.includes(assetText.slice(0, 200)), `${where}: file content`);
        assert.ok(
          !/root:|\[fonts\]|import "|Internal Server Error/.test(res.text),
          where,
        );
        if (host === "learn" && headers.host === undefined)
          assert.match(
            String(res.headers["content-security-policy"]),
            /default-src 'self'/,
            where,
          );
      }
    }
  }
});

test("the same holds for every method, and the answer is the one any other missing path gets", async () => {
  for (const host of HOSTS) {
    const other = await server.request(host, "GET", "/_no-such-path");
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of [`/_image?href=${asset}&w=1`, "/_image"]) {
        const where = `${host} ${method} ${path}`;
        const res = await server.request(host, method, path, {
          origin: `https://${host}.test`,
          form: method === "POST" ? { href: asset } : undefined,
        });
        assert.equal(res.status, 404, where);
        assert.ok(!res.text.includes(assetText.slice(0, 200)), where);
        if (method === "GET") {
          assert.equal(res.headers["content-type"], other.headers["content-type"], where);
          assert.equal(
            res.headers["content-security-policy"],
            other.headers["content-security-policy"],
            where,
          );
        }
      }
    }
  }
});

test("the apex and the blog host answer /_image exactly as they answer any missing page", async () => {
  for (const host of ["site", "blog"] as const) {
    const missing = await server.request(host, "GET", "/_no-such-path");
    const image = await server.request(host, "GET", `/_image?href=${asset}`);
    assert.equal(image.status, missing.status);
    // (The stock page prints the path it was asked for.)
    const bare = (text: string): string => text.replace(/<pre>Path: [^<]*<\/pre>/, "");
    assert.equal(bare(image.text), bare(missing.text));
  }
});

test("the build carries no image endpoint code", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : entry.name.endsWith(".mjs") || entry.name.endsWith(".js")
          ? [join(dir, entry.name)]
          : [],
    );
  const server = files(join(out, "server"));
  assert.ok(server.length > 0);
  for (const file of server) {
    const text = readFileSync(file, "utf8");
    assert.ok(
      !text.includes("Could not process image request"),
      `${file}: stock image endpoint`,
    );
    assert.ok(!text.includes("Configured image service is not a local service"), file);
  }
});

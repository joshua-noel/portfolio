import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, resolveRoute } from "../src/lib/routing.ts";

const route = (host: string, pathname: string, search = "") =>
  resolveRoute({
    host,
    pathname,
    search,
    blogHost: "blog.example.com",
    blogUrl: "https://blog.example.com",
    learnHost: "learn.example.com",
    learnUrl: "https://learn.example.com",
  });

test("apex serves its own pages", () => {
  assert.deepEqual(route("example.com", "/"), { kind: "pass" });
  assert.deepEqual(route("example.com", "/healthz"), { kind: "pass" });
});

test("apex hands blog and admin paths to the blog host", () => {
  assert.deepEqual(route("example.com", "/blog/a-post"), {
    kind: "redirect",
    location: "https://blog.example.com/a-post",
  });
  assert.deepEqual(route("example.com", "/blog"), {
    kind: "redirect",
    location: "https://blog.example.com/",
  });
  assert.deepEqual(route("example.com", "/admin/3"), {
    kind: "redirect",
    location: "https://blog.example.com/admin/3",
  });
});

test("blog host maps its root onto the /blog subtree", () => {
  assert.deepEqual(route("blog.example.com", "/"), { kind: "rewrite", path: "/blog" });
  assert.deepEqual(route("blog.example.com", "/a-post"), {
    kind: "rewrite",
    path: "/blog/a-post",
  });
});

test("the /blog prefix is never a reachable URL", () => {
  assert.deepEqual(route("blog.example.com", "/blog/a-post"), {
    kind: "redirect",
    location: "https://blog.example.com/a-post",
  });
});

test("learn host maps its root onto the /learn subtree", () => {
  assert.deepEqual(route("learn.example.com", "/"), { kind: "rewrite", path: "/learn" });
  assert.deepEqual(route("learn.example.com", "/attention"), {
    kind: "rewrite",
    path: "/learn/attention",
  });
  assert.deepEqual(route("learn.example.com", "/search", "?q=mask"), {
    kind: "rewrite",
    path: "/learn/search?q=mask",
  });
});

test("the /learn prefix is never a reachable URL, on any host", () => {
  for (const host of ["example.com", "blog.example.com", "learn.example.com"]) {
    assert.deepEqual(route(host, "/learn/attention", "?depth=deep"), {
      kind: "redirect",
      location: "https://learn.example.com/attention?depth=deep",
    });
    assert.deepEqual(route(host, "/learn"), {
      kind: "redirect",
      location: "https://learn.example.com/",
    });
  }
});

test("each mapped host hands the other's prefix and the admin to its owner", () => {
  assert.deepEqual(route("learn.example.com", "/blog/a-post"), {
    kind: "redirect",
    location: "https://blog.example.com/a-post",
  });
  assert.deepEqual(route("blog.example.com", "/admin/login"), { kind: "pass" });
  assert.deepEqual(route("learn.example.com", "/admin/login", "?next=%2Fadmin"), {
    kind: "redirect",
    location: "https://blog.example.com/admin/login?next=%2Fadmin",
  });
});

test("reserved segments on the learn host are served, not treated as lectures", () => {
  for (const path of ["/healthz", "/robots.txt", "/_astro/x.js", "/uploads/a.webp"]) {
    assert.deepEqual(route("learn.example.com", path), { kind: "pass" }, path);
  }
});

test("reserved segments are served, not treated as slugs", () => {
  for (const path of [
    "/admin",
    "/api/login",
    "/uploads/abc.webp",
    "/rss.xml",
    "/_astro/x.js",
  ]) {
    assert.deepEqual(route("blog.example.com", path), { kind: "pass" }, path);
  }
});

test("query strings survive both rewrites and redirects", () => {
  assert.deepEqual(route("blog.example.com", "/a-post", "?utm=1"), {
    kind: "rewrite",
    path: "/blog/a-post?utm=1",
  });
  assert.deepEqual(route("example.com", "/blog/a-post", "?utm=1"), {
    kind: "redirect",
    location: "https://blog.example.com/a-post?utm=1",
  });
});

test("client IP is the socket peer unless a loopback proxy forwarded it", () => {
  assert.equal(clientIp("198.51.100.7", "203.0.113.9"), "198.51.100.7");
  assert.equal(clientIp("198.51.100.7", null), "198.51.100.7");
  assert.equal(clientIp("127.0.0.1", "1.2.3.4, 203.0.113.9"), "203.0.113.9");
  assert.equal(clientIp("::1", "203.0.113.9"), "203.0.113.9");
  assert.equal(clientIp("::ffff:127.0.0.1", "203.0.113.9"), "203.0.113.9");
  assert.equal(clientIp("127.0.0.1", null), "127.0.0.1");
  assert.equal(clientIp("127.0.0.1", ""), "127.0.0.1");
});

test("a listed proxy's X-Forwarded-For is believed; an unlisted peer's is not", () => {
  const trusted = ["172.17.0.1"];
  assert.equal(clientIp("172.17.0.1", "1.2.3.4, 203.0.113.9", trusted), "203.0.113.9");
  assert.equal(clientIp("::ffff:172.17.0.1", "203.0.113.9", trusted), "203.0.113.9");
  assert.equal(clientIp("172.17.0.2", "203.0.113.9", trusted), "172.17.0.2");
  assert.equal(clientIp("172.17.0.1", "203.0.113.9"), "172.17.0.1");
});

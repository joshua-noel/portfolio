import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientIp,
  isForbiddenCrossOriginRequest,
  mayServeLocal,
  resolveRoute,
} from "../src/lib/routing.ts";

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

test("with one hop the last entry counts; with more hops, that many from the right", () => {
  // client -> proxy A -> proxy B -> app: the app's peer is B, which appended A.
  const chain = "198.51.100.1, 203.0.113.9";
  assert.equal(clientIp("127.0.0.1", chain, [], 1), "203.0.113.9");
  assert.equal(clientIp("127.0.0.1", chain, [], 2), "198.51.100.1");
  // A client's own forged leftmost entry never wins against two real hops.
  assert.equal(clientIp("127.0.0.1", `6.6.6.6, ${chain}`, [], 2), "198.51.100.1");
  // Fewer entries than hops means the chain is not what was configured: the peer.
  assert.equal(clientIp("127.0.0.1", "203.0.113.9", [], 2), "127.0.0.1");
  assert.equal(clientIp("127.0.0.1", null, [], 2), "127.0.0.1");
});

test("with zero trusted hops forwarded headers are ignored, from any peer", () => {
  assert.equal(clientIp("127.0.0.1", "203.0.113.9", [], 0), "127.0.0.1");
  assert.equal(clientIp("::1", "203.0.113.9", [], 0), "::1");
  assert.equal(clientIp("172.17.0.1", "203.0.113.9", ["172.17.0.1"], 0), "172.17.0.1");
  assert.equal(clientIp("198.51.100.7", "203.0.113.9", [], 0), "198.51.100.7");
});

test("a peer that is not a proxy is never believed, however many hops are set", () => {
  assert.equal(clientIp("198.51.100.7", "1.1.1.1, 2.2.2.2", [], 2), "198.51.100.7");
});

test("IPv6 clients are keyed on their /64", () => {
  const a = clientIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd", null);
  const b = clientIp("2001:db8:1:2:1::1", null);
  const other = clientIp("2001:db8:1:3::1", null);
  assert.equal(a, b);
  assert.notEqual(a, other);
  assert.equal(a, "2001:db8:1:2::/64");
  // Short forms, upper case and zone ids reach the same key.
  assert.equal(clientIp("2001:DB8:1:2::5", null), a);
  assert.equal(clientIp("2001:db8:1:2::5%eth0", null), a);
  // Behind a proxy the forwarded address is keyed the same way.
  assert.equal(clientIp("127.0.0.1", "2001:db8:1:2::9"), a);
  // IPv4, and an IPv4-mapped peer, keep the whole address.
  assert.equal(clientIp("::ffff:198.51.100.7", null), "198.51.100.7");
  assert.equal(clientIp("198.51.100.7", null), "198.51.100.7");
});

test("local lectures are for a loopback peer with no sign of a proxy", () => {
  const h = (init: Record<string, string> = {}): Headers => new Headers(init);
  assert.equal(mayServeLocal("127.0.0.1", h()), true);
  assert.equal(mayServeLocal("::1", h()), true);
  assert.equal(mayServeLocal("::ffff:127.0.0.1", h()), true);
  // Not loopback, or no peer known.
  assert.equal(mayServeLocal("203.0.113.9", h()), false);
  assert.equal(mayServeLocal("192.168.1.5", h()), false);
  assert.equal(mayServeLocal("::ffff:203.0.113.9", h()), false);
  assert.equal(mayServeLocal(undefined, h()), false);
  assert.equal(mayServeLocal("", h()), false);
  // A proxy on this machine says so, by any of its usual headers.
  for (const name of [
    "x-forwarded-for",
    "Forwarded",
    "VIA",
    "x-real-ip",
    "x-forwarded-proto",
    "x-forwarded-host",
    "cf-connecting-ip",
    "true-client-ip",
  ]) {
    assert.equal(mayServeLocal("127.0.0.1", h({ [name]: "1.2.3.4" })), false, name);
  }
});

test("a cross-site form post is refused; same-origin, safe methods and non-form bodies are not", () => {
  const post = (origin: string | null, contentType: string | null, method = "POST") =>
    isForbiddenCrossOriginRequest({
      method,
      origin,
      contentType,
      urlOrigin: "https://learn.example.com",
    });
  const form = "application/x-www-form-urlencoded";
  assert.equal(post("https://evil.test", form), true);
  assert.equal(post(null, form), true);
  assert.equal(post("https://evil.test", "multipart/form-data; boundary=x"), true);
  assert.equal(post("https://evil.test", "Text/Plain;charset=utf-8"), true);
  assert.equal(post("https://evil.test", null), true);
  assert.equal(post("https://learn.example.com", form), false);
  assert.equal(post("https://evil.test", "application/json"), false);
  assert.equal(post("https://evil.test", form, "GET"), false);
  assert.equal(post("https://evil.test", form, "HEAD"), false);
  assert.equal(post("https://evil.test", form, "DELETE"), true);
});

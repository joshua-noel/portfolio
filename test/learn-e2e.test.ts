import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT,
  OWNER,
  build,
  start,
  type Response,
  type Server,
} from "./helpers/server.ts";
import {
  SECRET,
  VISIBILITIES,
  visibilityLibrary,
  writeLibrary,
  type Visibility,
} from "./helpers/fixtures.ts";

/**
 * The whole thing, over HTTP: a real build, a real server, real cookies. It
 * is the only place that can prove the middleware, the routes and the loader
 * agree, so every rule the owner was promised is asserted here.
 */
const LEARN = "https://learn.test";
const BLOG = "https://blog.test";
const PASSWORD = "correct horse battery";

const library = mkdtempSync(join(tmpdir(), "portfolio-library-"));
writeLibrary(library, visibilityLibrary());

let out: string;
let server: Server;
let server2: Server;

/** Cookie for each kind of reader. */
const sessions: Record<string, string> = {};

// What each reader may open: written by hand, not computed.
const READS: Record<string, Visibility[]> = {
  visitor: ["public"],
  member: ["public", "members"],
  friend: ["public", "members", "friends"],
  admin: ["public", "members", "friends"],
};
const ACCOUNTS = { member: "mia", friend: "fay", admin: "adam" } as const;

let ipCounter = 0;
const freshIp = (): Record<string, string> => ({
  "x-forwarded-for": `198.51.100.${(ipCounter = (ipCounter % 250) + 1)}`,
});

/** Signs in on the lecture host the way the form does; returns the cookie to send back. */
async function signInAs(
  username: string,
  password: string,
  extra: Record<string, string> = {},
): Promise<{ cookie: string; res: Response }> {
  const res = await server.request("learn", "POST", "/signin", {
    form: { username, password, next: "/" },
    origin: LEARN,
    headers: { ...freshIp(), ...extra },
  });
  const pair =
    res.cookies.find((c) => c.startsWith("learn_session="))?.split(";")[0] ?? "";
  return { cookie: pair, res };
}

before(async () => {
  out = build({ PORTFOLIO_LEARN_CONTENT_DIRS: library });
  server = await start({ out, contentDirs: [library] });
  assert.equal(
    server.user(["add", ACCOUNTS.member, "--role", "member"], { password: PASSWORD })
      .status,
    0,
  );
  assert.equal(
    server.user(["add", ACCOUNTS.friend, "--role", "friend"], { password: PASSWORD })
      .status,
    0,
  );
  assert.equal(
    server.user(["add", ACCOUNTS.admin, "--role", "admin"], { password: PASSWORD })
      .status,
    0,
  );
  // A second server on the owner's-own-machine switch, for the local lecture.
  server2 = await start({
    out,
    contentDirs: [library],
    env: { PORTFOLIO_LEARN_ALLOW_LOCAL: "1" },
  });

  sessions.visitor = "";
  for (const [role, name] of Object.entries(ACCOUNTS))
    sessions[role] = (await signInAs(name, PASSWORD)).cookie;
});

after(async () => {
  await server?.stop();
  await server2?.stop();
});

test("every role against every visibility, on every kind of route", async () => {
  for (const [role, readable] of Object.entries(READS)) {
    const cookie = sessions[role];
    for (const v of VISIBILITIES) {
      const open = readable.includes(v);
      const where = `${role} on ${v}`;
      const canary = SECRET[v];

      // The lecture page.
      const page = await server.request("learn", "GET", `/c-${v}/l-${v}`, { cookie });
      if (v === "local") assert.equal(page.status, 404, where);
      else assert.equal(page.status, open ? 200 : 403, where);
      assert.equal(page.text.includes(canary), open, `${where}: canary in the page`);

      // The course page.
      const course = await server.request("learn", "GET", `/c-${v}`, { cookie });
      assert.equal(course.status, v === "local" ? 404 : 200, where);
      assert.equal(
        course.text.includes(canary),
        open,
        `${where}: canary on the course page`,
      );

      // Search, as JSON and as a page.
      const json = await server.request("learn", "GET", `/search.json?q=${canary}`, {
        cookie,
      });
      assert.deepEqual(
        JSON.parse(json.text).map((h: { url: string }) => h.url),
        open ? [`/c-${v}/l-${v}`] : [],
        `${where}: search.json`,
      );
      const results = await server.request("learn", "GET", `/search?q=${canary}`, {
        cookie,
      });
      assert.equal(
        results.text.includes(`href="/c-${v}/l-${v}"`),
        open,
        `${where}: search page`,
      );

      // Video and captions.
      for (const [ext, type] of [
        ["mp4", "video/mp4"],
        ["vtt", "text/vtt"],
      ] as const) {
        const media = await server.request(
          "learn",
          "GET",
          `/media/c-${v}/01-l-${v}.${ext}`,
          { cookie },
        );
        assert.equal(media.status, open ? 200 : 404, `${where}: ${ext}`);
        if (open) {
          assert.match(String(media.headers["content-type"]), new RegExp(type));
          assert.ok(media.text.includes(canary));
        } else assert.ok(!media.text.includes(canary));
      }
    }

    // The landing page lists every course that is not local, with a lock where this reader may not open it,
    // and shows a locked course's title and promise but nothing else.
    const landing = await server.request("learn", "GET", "/", { cookie });
    assert.equal(landing.status, 200);
    for (const v of VISIBILITIES) {
      const listed = landing.text.includes(`Course c-${v}`);
      assert.equal(listed, v !== "local", `${role}: course c-${v} listed`);
      if (v !== "local") assert.ok(landing.text.includes(`Promise of Lecture ${v}.`));
      assert.equal(
        landing.text.includes(SECRET[v]),
        false,
        `${role}: no canary on the landing page`,
      );
    }
    const locks = (landing.text.match(/class="lock"/g) ?? []).length;
    assert.ok(
      role === "visitor" ? locks > 0 : role === "member" ? locks > 0 : locks === 0,
      `${role}: locks ${locks}`,
    );
  }
});

test("the sitemap is the same for everyone, and holds nothing a visitor may not read", async () => {
  for (const cookie of Object.values(sessions)) {
    const map = await server.request("site", "GET", "/sitemap.xml", { cookie });
    assert.equal(map.status, 200);
    for (const v of ["members", "friends", "local"]) {
      assert.ok(!map.text.includes(`l-${v}`), `${v} slug in the sitemap`);
      assert.ok(!map.text.includes(`c-${v}`));
      assert.ok(!map.text.includes(SECRET[v as Visibility]));
    }
    assert.ok(map.text.includes("https://learn.test/"));
  }
});

test("locked pages say what it is and nothing more, with no leak in headers or the page", async () => {
  const res = await server.request("learn", "GET", "/c-friends/l-friends");
  assert.equal(res.status, 403);
  assert.match(res.text, /Lecture friends/);
  assert.match(res.text, /Promise of Lecture friends\./);
  assert.match(res.text, /Sign in to read/);
  assert.match(res.text, /href="\/signin\?next=%2Fc-friends%2Fl-friends"/);
  for (const secret of [
    SECRET.friends,
    "Objective",
    "Source ",
    "example.com",
    "Tip text",
    "Caption",
    "Diagram title",
    "01-l-friends",
    "min read",
    "On this page",
    "Check yourself",
    "Show answer",
  ]) {
    assert.ok(!res.text.includes(secret), `"${secret}" on the locked page`);
  }
  assert.ok(!res.text.includes("<video"));
  assert.ok(!res.text.includes("data-toc"));
  const headers = JSON.stringify(res.headers);
  assert.ok(!headers.includes("friends-"), headers);
  assert.ok(!headers.toLowerCase().includes("canary"));
  assert.match(String(res.headers["cache-control"]), /private/);
  assert.match(String(res.headers.vary), /Cookie/i);

  const members = await server.request("learn", "GET", "/c-members/l-members");
  assert.match(members.text, /Membership is not open yet/);

  // Prev/next and the sidebar of an open lecture carry titles only.
  const open = await server.request("learn", "GET", "/c-public/l-public", { cookie: "" });
  assert.equal(open.status, 200);
  assert.ok(!open.text.includes(SECRET.members) && !open.text.includes(SECRET.friends));
});

test("no error page leaks: unknown lecture, unknown course, bad media names, traversal", async () => {
  for (const path of [
    "/c-public/nope",
    "/nope",
    "/nope/nope",
    "/c-local",
    "/c-local/l-local",
    "/media/c-public/..%2Fcourse.md",
    "/media/c-public/01-l-public.md",
    "/media/c-public/course.md",
    "/media/c-public/01-l-public.mp4.exe",
    "/media/..%2F..%2Fpackage.json/x",
    "/media/c-members/01-l-members.mp4",
  ]) {
    const res = await server.request("learn", "GET", path, { cookie: sessions.visitor });
    assert.ok([404, 403].includes(res.status), `${path}: ${res.status}`);
    for (const v of ["members", "friends", "local"])
      assert.ok(!res.text.includes(SECRET[v as Visibility]), `${path}: ${v} canary`);
    assert.ok(
      !res.text.includes(ROOT) && !res.text.includes(library),
      `${path}: a path of the server's disk`,
    );
  }
  const forbidden = await server.request(
    "learn",
    "GET",
    "/media/c-public/01-l-public.mp4",
    { headers: { range: "bytes=2-4" } },
  );
  assert.equal(forbidden.status, 206);
  assert.equal(forbidden.text, "DEO");
});

test("a local lecture is not served by a server, and the switch for it is the owner's alone", async () => {
  // Off: it is nowhere, for any role.
  for (const cookie of Object.values(sessions)) {
    for (const path of [
      "/c-local/l-local",
      "/c-local",
      "/media/c-local/01-l-local.mp4",
      `/search.json?q=${SECRET.local}`,
    ]) {
      const res = await server.request("learn", "GET", path, { cookie });
      assert.ok(
        !res.text.includes(SECRET.local) && (res.status === 404 || res.status === 200),
        path,
      );
      if (!path.startsWith("/search")) assert.equal(res.status, 404, path);
    }
  }
  // On, on the owner's own loopback instance: served, and it said so loudly.
  const res = await server2.request("learn", "GET", "/c-local/l-local");
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(SECRET.local));
  assert.match(server2.stderr(), /PORTFOLIO_LEARN_ALLOW_LOCAL=1/);
  // And a server that could be reached by others refuses to start with it.
  const refused = spawnSync(process.execPath, [join(ROOT, "bin", "serve.mjs")], {
    env: {
      ...process.env,
      PORTFOLIO_SITE_URL: "http://a",
      PORTFOLIO_BLOG_URL: "http://b",
      PORTFOLIO_LEARN_URL: "http://c",
      PORTFOLIO_ADMIN_PASSWORD_HASH: "x",
      PORTFOLIO_LEARN_ALLOW_LOCAL: "1",
      PORTFOLIO_HOST: "0.0.0.0",
    },
    encoding: "utf8",
  });
  assert.equal(refused.status, 78);
  assert.match(refused.stderr, /refuses to run on 0\.0\.0\.0/);
});

test("the cookie belongs to the lecture host, and is HttpOnly, Secure and SameSite=Lax", async () => {
  const { res, cookie } = await signInAs(ACCOUNTS.friend, PASSWORD);
  assert.equal(res.status, 303);
  assert.ok(cookie.startsWith("learn_session="));
  const header = res.cookies.find((c) => c.startsWith("learn_session="))!;
  assert.match(header, /; HttpOnly/i);
  assert.match(header, /; Secure/i);
  assert.match(header, /; SameSite=Lax/i);
  assert.match(header, /; Path=\//i);
  assert.doesNotMatch(header, /Domain=/i, "host-only");
  assert.match(header, /Expires=/i);
  assert.ok(
    res.cookies.every((c) => !c.startsWith("portfolio_session=")),
    "the admin's cookie is not touched",
  );
});

test("a friend or member session is worthless on the blog's admin and API", async () => {
  for (const role of ["member", "friend", "admin"]) {
    const token = sessions[role]!.split("=")[1]!;
    for (const name of ["portfolio_session", "learn_session"]) {
      const cookie = `${name}=${token}`;
      const admin = await server.request("blog", "GET", "/admin", { cookie });
      assert.equal(admin.status, 303, `${role} ${name}: admin page`);
      assert.match(String(admin.headers.location), /^\/admin\/login/);
      const write = await server.request("blog", "POST", "/api/posts", {
        cookie,
        origin: BLOG,
      });
      assert.equal(write.status, 401, `${role} ${name}: API write`);
      const upload = await server.request("blog", "POST", "/api/upload", {
        cookie,
        origin: BLOG,
      });
      assert.equal(upload.status, 401, `${role} ${name}: upload`);
    }
  }
});

test("the admin signs in on the blog as before, that session is not a lecture session, and the admin signs in on learn too", async () => {
  const login = await server.request("blog", "POST", "/api/login", {
    form: { username: OWNER.username, password: OWNER.password, next: "/admin" },
    origin: BLOG,
    headers: freshIp(),
  });
  assert.equal(login.status, 303);
  const adminCookie = login.cookies
    .find((c) => c.startsWith("portfolio_session="))!
    .split(";")[0]!;
  assert.equal(
    (await server.request("blog", "GET", "/admin", { cookie: adminCookie })).status,
    200,
  );

  const token = adminCookie.split("=")[1]!;
  for (const name of ["portfolio_session", "learn_session"]) {
    const res = await server.request("learn", "GET", "/c-members/l-members", {
      cookie: `${name}=${token}`,
    });
    assert.equal(res.status, 403, `an admin-site session as ${name} on the lecture host`);
  }

  const { cookie } = await signInAs(OWNER.username, OWNER.password);
  assert.ok(cookie);
  for (const v of ["public", "members", "friends"]) {
    assert.equal(
      (await server.request("learn", "GET", `/c-${v}/l-${v}`, { cookie })).status,
      200,
      v,
    );
  }
  // ...and that session does not open the blog admin.
  assert.equal(
    (
      await server.request("blog", "GET", "/admin", {
        cookie: `portfolio_session=${cookie.split("=")[1]}`,
      })
    ).status,
    303,
  );
});

test("the lecture host has no admin and no API", async () => {
  assert.equal(
    (
      await server.request("learn", "POST", "/api/login", {
        origin: LEARN,
        form: { username: "x", password: "y" },
      })
    ).status,
    404,
  );
  assert.equal((await server.request("learn", "GET", "/api/posts")).status, 404);
  const admin = await server.request("learn", "GET", "/admin/login");
  assert.equal(admin.status, 301);
  assert.equal(admin.headers.location, "https://blog.test/admin/login");
});

test("signing in or out from another origin, or from none, is refused", async () => {
  for (const origin of [
    null,
    "https://evil.example",
    "https://blog.test",
    "http://learn.test",
    "https://learn.test.evil.example",
  ]) {
    const res = await server.request("learn", "POST", "/signin", {
      form: { username: ACCOUNTS.friend, password: PASSWORD, next: "/" },
      origin,
      headers: freshIp(),
    });
    assert.equal(res.status, 403, String(origin));
    assert.deepEqual(res.cookies, []);
  }
  const live = await signInAs(ACCOUNTS.friend, PASSWORD);
  for (const origin of [null, "https://evil.example"]) {
    const res = await server.request("learn", "POST", "/signout", {
      cookie: live.cookie,
      origin,
    });
    assert.equal(res.status, 403, String(origin));
  }
  assert.equal(
    (
      await server.request("learn", "GET", "/c-friends/l-friends", {
        cookie: live.cookie,
      })
    ).status,
    200,
    "still signed in",
  );
  // A link or an image is a GET, which signs nobody out.
  const get = await server.request("learn", "GET", "/signout", { cookie: live.cookie });
  assert.equal(get.status, 303);
  assert.equal(
    (
      await server.request("learn", "GET", "/c-friends/l-friends", {
        cookie: live.cookie,
      })
    ).status,
    200,
  );
});

test("signing out deletes the session on the server, so a copied cookie is dead too", async () => {
  const { cookie } = await signInAs(ACCOUNTS.member, PASSWORD);
  assert.equal(
    (await server.request("learn", "GET", "/c-members/l-members", { cookie })).status,
    200,
  );
  const out = await server.request("learn", "POST", "/signout", {
    cookie,
    origin: LEARN,
  });
  assert.equal(out.status, 303);
  assert.match(
    out.cookies.find((c) => c.startsWith("learn_session="))!,
    /learn_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i,
  );
  assert.equal(
    (await server.request("learn", "GET", "/c-members/l-members", { cookie })).status,
    403,
  );
});

test("a failed sign-in looks the same whoever the name belongs to", async () => {
  server.user(["add", "gone", "--role", "friend"], { password: PASSWORD });
  server.user(["disable", "gone"]);
  const attempts = [
    [ACCOUNTS.friend, "wrong password"],
    ["nobody-at-all", PASSWORD],
    ["gone", PASSWORD],
    ["Not A Name!", PASSWORD],
    [OWNER.username, "wrong password"],
  ];
  const seen = new Set<string>();
  for (const [username, password] of attempts) {
    const res = await server.request("learn", "POST", "/signin", {
      form: { username: username!, password: password!, next: "/c-friends/l-friends" },
      origin: LEARN,
      headers: freshIp(),
    });
    assert.equal(res.status, 303);
    assert.deepEqual(res.cookies, []);
    seen.add(String(res.headers.location));
  }
  assert.deepEqual([...seen], ["/signin?next=%2Fc-friends%2Fl-friends&failed"]);
  const page = await server.request("learn", "GET", "/signin?next=%2F&failed");
  assert.match(page.text, /Incorrect username or password\./);
});

test("five failures lock the address, even for the right password", async () => {
  const ip = { "x-forwarded-for": "203.0.113.77" };
  for (let i = 0; i < 5; i++) {
    const res = await server.request("learn", "POST", "/signin", {
      form: { username: "nobody", password: "nope", next: "/" },
      origin: LEARN,
      headers: ip,
    });
    assert.match(String(res.headers.location), /failed/);
  }
  const locked = await server.request("learn", "POST", "/signin", {
    form: { username: ACCOUNTS.friend, password: PASSWORD, next: "/" },
    origin: LEARN,
    headers: ip,
  });
  assert.match(String(locked.headers.location), /locked/);
  assert.deepEqual(locked.cookies, []);
  const page = await server.request("learn", "GET", "/signin?next=%2F&locked");
  assert.match(page.text, /Too many attempts/);
  // The admin's lockout is its own: this address is not locked out of the blog's login.
  const blog = await server.request("blog", "POST", "/api/login", {
    form: { username: "x", password: "y", next: "/admin" },
    origin: BLOG,
    headers: ip,
  });
  assert.match(String(blog.headers.location), /failed/);
});

test("next only goes to a path on the lecture host", async () => {
  const next = async (value: string): Promise<string> => {
    const res = await server.request("learn", "POST", "/signin", {
      form: { username: ACCOUNTS.friend, password: PASSWORD, next: value },
      origin: LEARN,
      headers: freshIp(),
    });
    assert.equal(res.status, 303);
    return String(res.headers.location);
  };
  assert.equal(
    await next("/c-friends/l-friends?depth=deep"),
    "/c-friends/l-friends?depth=deep",
  );
  for (const evil of [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/signin",
    "",
  ]) {
    assert.equal(await next(evil), "/", evil);
  }
});

test("an oversized sign-in body is refused before it is read", async () => {
  const res = await server.request("learn", "POST", "/signin", {
    form: { username: "a", password: "x".repeat(5000), next: "/" },
    origin: LEARN,
    headers: freshIp(),
  });
  assert.equal(res.status, 413);
});

test("sign-in rotates the session: the cookie sent with it is dead afterwards", async () => {
  const first = await signInAs(ACCOUNTS.friend, PASSWORD);
  const second = await signInAs(ACCOUNTS.friend, PASSWORD, {});
  const rotated = await server.request("learn", "POST", "/signin", {
    cookie: first.cookie,
    form: { username: ACCOUNTS.friend, password: PASSWORD, next: "/" },
    origin: LEARN,
    headers: freshIp(),
  });
  const fresh = rotated.cookies
    .find((c) => c.startsWith("learn_session="))!
    .split(";")[0]!;
  assert.notEqual(fresh, first.cookie);
  assert.equal(
    (
      await server.request("learn", "GET", "/c-friends/l-friends", {
        cookie: first.cookie,
      })
    ).status,
    403,
    "the old session",
  );
  assert.equal(
    (await server.request("learn", "GET", "/c-friends/l-friends", { cookie: fresh }))
      .status,
    200,
  );
  assert.equal(
    (
      await server.request("learn", "GET", "/c-friends/l-friends", {
        cookie: second.cookie,
      })
    ).status,
    200,
    "another device is not signed out",
  );
  // A token the browser makes up is not a session.
  assert.equal(
    (
      await server.request("learn", "GET", "/c-members/l-members", {
        cookie: "learn_session=attacker-chosen",
      })
    ).status,
    403,
  );
});

test("disabling an account ends its sessions at once, and it cannot sign in again", async () => {
  server.user(["add", "temp", "--role", "friend"], { password: PASSWORD });
  const { cookie } = await signInAs("temp", PASSWORD);
  assert.equal(
    (await server.request("learn", "GET", "/c-friends/l-friends", { cookie })).status,
    200,
  );
  const disabled = server.user(["disable", "temp"]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(disabled.stdout, /1 session\(s\) ended/);
  assert.equal(
    (await server.request("learn", "GET", "/c-members/l-members", { cookie })).status,
    403,
  );
  assert.equal((await signInAs("temp", PASSWORD)).cookie, "");
  server.user(["enable", "temp"]);
  assert.ok((await signInAs("temp", PASSWORD)).cookie);
});

test("a role change applies to a live session on its next request", async () => {
  server.user(["add", "shift", "--role", "member"], { password: PASSWORD });
  const { cookie } = await signInAs("shift", PASSWORD);
  assert.equal(
    (await server.request("learn", "GET", "/c-friends/l-friends", { cookie })).status,
    403,
  );
  assert.equal(server.user(["set-role", "shift", "--role", "friend"]).status, 0);
  assert.equal(
    (await server.request("learn", "GET", "/c-friends/l-friends", { cookie })).status,
    200,
  );
  server.user(["set-role", "shift", "--role", "member"]);
  assert.equal(
    (await server.request("learn", "GET", "/c-friends/l-friends", { cookie })).status,
    403,
  );
});

test("changing a password ends the account's sessions", async () => {
  server.user(["add", "pw", "--role", "friend"], { password: PASSWORD });
  const { cookie } = await signInAs("pw", PASSWORD);
  const changed = server.user(["set-password", "pw"], {
    password: "a different password",
  });
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(
    (await server.request("learn", "GET", "/c-friends/l-friends", { cookie })).status,
    403,
  );
  assert.equal((await signInAs("pw", PASSWORD)).cookie, "");
  assert.ok((await signInAs("pw", "a different password")).cookie);
});

test("the top bar shows who is signed in, and a way out", async () => {
  const visitor = await server.request("learn", "GET", "/c-public/l-public");
  assert.match(
    visitor.text,
    /class="signin" href="\/signin\?next=%2Fc-public%2Fl-public"/,
  );
  assert.doesNotMatch(visitor.text, /action="\/signout"/);
  const friend = await server.request("learn", "GET", "/c-public/l-public", {
    cookie: sessions.friend,
  });
  assert.match(friend.text, /action="\/signout"/);
  assert.match(friend.text, />fay</);
  assert.doesNotMatch(friend.text, /href="\/signin/);
});

test("the user command: what it accepts and refuses", () => {
  const u = (args: string[], password?: string, env?: Record<string, string>) =>
    server.user(args, { password, env });
  assert.equal(u(["add", "casey", "--role", "friend"], PASSWORD).status, 0);
  assert.match(
    u(["add", "casey", "--role", "friend"], PASSWORD).stderr,
    /already exists/,
  );
  assert.match(
    u(["add", "Casey2", "--role", "root"], PASSWORD).stderr,
    /--role is one of admin, friend, member/,
  );
  assert.match(u(["add", "x", "--role", "friend"], PASSWORD).stderr, /not a username/);
  assert.match(
    u(["add", "dave", "--role", "friend"], "short").stderr,
    /at least 10 characters/,
  );
  assert.match(
    u(["add", "dave", "--role", "friend", "--password", PASSWORD]).stderr,
    /never an argument/,
  );
  assert.match(
    u(["add", "dave", "--role", "friend", "--pass=x"]).stderr,
    /never an argument/,
  );
  assert.match(
    u(["add", OWNER.username, "--role", "friend"], PASSWORD, {
      PORTFOLIO_ADMIN_USERNAME: OWNER.username,
    }).stderr,
    /environment admin's name/,
  );
  assert.match(u(["disable", "nobody"]).stderr, /no account called "nobody"/);
  assert.equal(u(["frobnicate"]).status, 2);
  const list = u(["list"]);
  assert.match(list.stdout, /casey\s+friend/);
  assert.match(list.stdout, /gone\s+friend.*disabled/);
  assert.ok(!list.stdout.includes("scrypt"), "no hashes in the listing");
  // No database, no guessing.
  assert.match(
    u(["list"], undefined, { PORTFOLIO_STATE_DIR: join(tmpdir(), "no-such-state-dir") })
      .stderr,
    /no database at/,
  );
});

test("the build output holds no non-public text, and no lecture at all", () => {
  const canaries = [
    SECRET.members,
    SECRET.friends,
    SECRET.local,
    SECRET.public,
    "Course c-members",
    "Course c-friends",
    "Promise of Lecture",
    "Objective CANARY",
  ];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const text = readFileSync(path, "latin1");
        for (const canary of canaries)
          if (text.includes(canary)) found.push(`${canary} in ${path}`);
      }
    }
  };
  walk(out);
  assert.deepEqual(
    found,
    [],
    "the library was configured at build time; none of it may be in the output",
  );
});

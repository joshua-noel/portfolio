import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hashPassword } from "../src/lib/password.ts";
import {
  ROOT,
  OWNER,
  build,
  start,
  type Response,
  type Server,
} from "./helpers/server.ts";
import { Browser, findBrowser, type Page, type PageOptions } from "./helpers/browser.ts";
import {
  DIAGRAM,
  SECRET,
  VISIBILITIES,
  lectureMarkdown,
  visibilityLibrary,
  writeLibrary,
  type Visibility,
} from "./helpers/fixtures.ts";

/**
 * The whole thing, over HTTP: a real build, a real server, real cookies. It
 * is the only place that can prove the middleware, the routes and the loader
 * agree, so every rule the owner was promised is asserted here.
 */
// The Nix build runs the unit tests in a sandbox that has just built the
// site; building it again here would only repeat that, and the VM test is the
// end-to-end check there.
if (process.env.PORTFOLIO_SKIP_E2E) process.exit(0);

const LEARN = "https://learn.test";
const BLOG = "https://blog.test";
const PASSWORD = "correct horse battery";
// The test server answers as https (X-Forwarded-Proto), so the cookie has the __Host- name.
const COOKIE = "__Host-learn_session";

const library = mkdtempSync(join(tmpdir(), "portfolio-library-"));
writeLibrary(library, visibilityLibrary());

let out: string;
let server: Server;
/** A headless Chromium for the landing page checks, started by the first test that needs it. */
let browser: Browser | undefined;

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
    res.cookies.find((c) => c.startsWith(COOKIE + "="))?.split(";")[0] ?? "";
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

  sessions.visitor = "";
  for (const [role, name] of Object.entries(ACCOUNTS))
    sessions[role] = (await signInAs(name, PASSWORD)).cookie;
});

after(async () => {
  await browser?.close();
  await server?.stop();
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
          `/media/c-${v}/l-${v}.${ext}`,
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
    "/media/c-public/l-public.md",
    "/media/c-public/course.md",
    "/media/c-public/l-public.mp4.exe",
    "/media/..%2F..%2Fpackage.json/x",
    "/media/c-members/l-members.mp4",
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
    "/media/c-public/l-public.mp4",
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
      "/media/c-local/l-local.mp4",
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
  // The switch is the owner's own machine's, under the dev server, and no
  // setting makes the built server serve it. Each of these is a server somebody
  // might run: behind a same-host proxy on a real hostname (every request then
  // arrives from loopback with no forwarded headers), with a localhost URL, and
  // started directly the way the review described. None may serve a local lecture.
  const refusals: Record<string, string>[] = [
    { PORTFOLIO_LEARN_ALLOW_LOCAL: "1" },
    {
      PORTFOLIO_LEARN_ALLOW_LOCAL: "1",
      PORTFOLIO_LEARN_URL: "http://learn.localhost:4321",
    },
    { PORTFOLIO_LEARN_ALLOW_LOCAL: "1", HOST: "127.0.0.1", PORTFOLIO_HOST: "127.0.0.1" },
  ];
  for (const env of refusals) {
    const refusing = await start({ out, contentDirs: [library], env, anyAnswer: true });
    try {
      for (const path of ["/c-local/l-local", "/", "/healthz"]) {
        const res = await refusing.request("learn", "GET", path);
        assert.ok(!res.text.includes(SECRET.local), `${path} with ${JSON.stringify(env)}`);
        assert.notEqual(res.status, 200, `${path} with ${JSON.stringify(env)}`);
      }
      assert.match(refusing.stderr(), /PORTFOLIO_LEARN_ALLOW_LOCAL=1 serves local lectures/);
    } finally {
      await refusing.stop();
    }
  }
  // The launcher refuses outright, whatever it would listen on.
  for (const host of ["0.0.0.0", "127.0.0.1"]) {
    const refused = spawnSync(process.execPath, [join(ROOT, "bin", "serve.mjs")], {
      env: {
        ...process.env,
        PORTFOLIO_SITE_URL: "http://a",
        PORTFOLIO_BLOG_URL: "http://b",
        PORTFOLIO_LEARN_URL: "http://learn.localhost",
        PORTFOLIO_ADMIN_PASSWORD_HASH: "x",
        PORTFOLIO_LEARN_ALLOW_LOCAL: "1",
        PORTFOLIO_HOST: host,
      },
      encoding: "utf8",
    });
    assert.equal(refused.status, 78, host);
    assert.match(refused.stderr, /refused by the production server/);
  }
});

test("the cookie belongs to the lecture host, and is HttpOnly, Secure and SameSite=Lax", async () => {
  const { res, cookie } = await signInAs(ACCOUNTS.friend, PASSWORD);
  assert.equal(res.status, 303);
  assert.ok(cookie.startsWith(`${COOKIE}=`));
  const header = res.cookies.find((c) => c.startsWith(`${COOKIE}=`))!;
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

test("a cookie planted under the plain name is not a session on https (cookie tossing)", async () => {
  const token = sessions.admin!.split("=")[1]!;
  // The right token, in the cookie a script on another host could set with Domain=.
  const planted = await server.request("learn", "GET", "/c-friends/l-friends", {
    cookie: `learn_session=${token}`,
  });
  assert.equal(planted.status, 403);
  assert.ok(!planted.text.includes(SECRET.friends));
  // The same token under the __Host- name is the session it is.
  const real = await server.request("learn", "GET", "/c-friends/l-friends", {
    cookie: `${COOKIE}=${token}`,
  });
  assert.equal(real.status, 200);
  // On plain http (local development) the plain name is the one, and the other is not.
  const http = { "x-forwarded-proto": "http" };
  assert.equal(
    (
      await server.request("learn", "GET", "/c-friends/l-friends", {
        cookie: `learn_session=${token}`,
        headers: http,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await server.request("learn", "GET", "/c-friends/l-friends", {
        cookie: `${COOKIE}=${token}`,
        headers: http,
      })
    ).status,
    403,
  );
});

test("a friend or member session is worthless on the blog's admin and API", async () => {
  for (const role of ["member", "friend", "admin"]) {
    const token = sessions[role]!.split("=")[1]!;
    for (const name of ["portfolio_session", COOKIE, "learn_session"]) {
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
    out.cookies.find((c) => c.startsWith(`${COOKIE}=`))!,
    /Max-Age=0|Expires=Thu, 01 Jan 1970/i,
  );
  // Both names are cleared, and the __Host- one is still Secure, or a browser would ignore the clearing.
  assert.match(out.cookies.find((c) => c.startsWith(`${COOKIE}=`))!, /; Secure/i);
  assert.ok(out.cookies.some((c) => c.startsWith("learn_session=")), "the plain name is cleared too");
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
    .find((c) => c.startsWith(`${COOKIE}=`))!
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
        cookie: `${COOKIE}=attacker-chosen`,
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

// ---------------------------------------------------------------------------
// The landing page: books on shelves

/** The books the page lists, with whether each is locked, from the HTML alone. */
function booksIn(html: string): Record<string, { locked: boolean }> {
  const found: Record<string, { locked: boolean }> = {};
  for (const [tag] of html.matchAll(/<li class="book"[^>]*>/g)) {
    const slug = /data-slug="([^"]+)"/.exec(tag)?.[1];
    assert.ok(slug, `a book names its course: ${tag}`);
    found[slug] = { locked: /\sdata-locked/.test(tag) };
  }
  return found;
}

test("the landing page lists the right books and locks for every reader, with the links in the HTML and no locked text", async () => {
  for (const [role, readable] of Object.entries(READS)) {
    const res = await server.request("learn", "GET", "/", { cookie: sessions[role] });
    const where = `${role} on the landing page`;
    assert.equal(res.status, 200, where);

    // One book per course the reader is told of: every kind but `local`, which a server never serves.
    const books = booksIn(res.text);
    assert.deepEqual(Object.keys(books).sort(), ["c-friends", "c-members", "c-public"], where);
    for (const v of ["public", "members", "friends"] as const) {
      assert.equal(books[`c-${v}`]!.locked, !readable.includes(v), `${where}: lock on ${v}`);
    }
    assert.doesNotMatch(res.text, /c-local/, `${where}: no local course`);

    // Books in the catalog's order, numbered from 01; one shelf with no book has no option in the capsule.
    const order = [...res.text.matchAll(/<li class="book"[^>]*data-index="(\d+)"[^>]*data-slug="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(order, ["0:c-public", "1:c-members", "2:c-friends"], where);
    const pills = [...res.text.matchAll(/data-filter="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(pills, ["all", "shelf:foundations", "shelf:systems", "shelf:agents"], where);
    assert.doesNotMatch(res.text, /data-filter="video"/, where);

    // Every lecture is a real link in the HTML, locked ones included, and only the ones that may be opened say so.
    for (const v of ["public", "members", "friends"] as const) {
      const open = readable.includes(v);
      const link = new RegExp(`<a href="/c-${v}/l-${v}"([^>]*)>`).exec(res.text);
      assert.ok(link, `${where}: link to the lecture of ${v}`);
      assert.equal(/is-locked/.test(link[1]!), !open, `${where}: locked lecture of ${v}`);
      assert.equal(/data-lecture-key/.test(link[1]!), open, `${where}: progress key of ${v}`);
    }

    // A cover illustration is drawn, once, for a course the reader may open, and for no other: a locked book is a plain cover.
    for (const v of ["public", "members", "friends"] as const) {
      // The page names each cover's own image and holds none of its art.
      assert.equal(res.text.includes(`ART-c-${v}`), false, `${where}: the art of ${v} is not in the page`);
      assert.ok(res.text.includes(`data-cover="/covers/c-${v}.svg"`), `${where}: the cover of ${v} is its own image`);
      const book = new RegExp(`<li class="book"[^>]*data-slug="c-${v}"[\\s\\S]*?<div class="detail"`).exec(res.text)?.[0] ?? "";
      assert.equal(/class="c-art"|class="s-art"|class="c-motif"/.test(book), false, `${where}: nothing else drawn for ${v}`);
    }
    assert.doesNotMatch(res.text, /ART-c-local/, `${where}: no art of the local course`);

    // The page names no one's body, sources or objectives: none of the canaries, open or locked.
    for (const v of VISIBILITIES) {
      assert.equal(res.text.includes(SECRET[v]), false, `${where}: canary of ${v}`);
    }

    // A locked book says why and how to get in, and no more.
    const locked = readable.length < 3;
    if (role === "visitor") {
      assert.match(res.text, /href="\/signin\?next=%2F"[^>]*>\s*Sign in to read/, where);
      assert.match(res.text, /This is for members/, where);
    } else if (locked) {
      assert.doesNotMatch(res.text, /Sign in to read/, where);
    }
    assert.equal(/Your account cannot read this/.test(res.text), role !== "visitor" && locked, where);
    if (readable.length === 3) assert.doesNotMatch(res.text, /d-locked/, `${where}: nothing locked`);

    // What a visitor needs first. No depths: they are not on the site any more.
    assert.match(res.text, /<h1[^>]*>Learn<\/h1>/, where);
    assert.doesNotMatch(res.text, /depth|Waterline|Abyss|data-d=/i, `${where}: no depth wording`);
    assert.match(res.text, /role="search"/, where);
    // The top bar has no links to the shelves; "Learn" goes to the landing page.
    assert.doesNotMatch(res.text, /parts-nav|aria-label="Shelves"/, where);
    assert.match(res.text, /<header class="topbar"[\s\S]*?<a [^>]*href="\/"[^>]*>[\s\S]*?Learn/, where);
  }
});

/** The page without the address it was asked at: a visitor's "Sign in" link says where to come back to. */
const withoutNext = (html: string): string => html.replace(/\/signin\?next=[^"]*/g, "/signin");

test("the landing page ignores a ?depth= left in an old link", async () => {
  const plain = withoutNext((await server.request("learn", "GET", "/")).text);
  for (const query of ["?depth=abyss", "?depth=nonsense"]) {
    const res = await server.request("learn", "GET", `/${query}`);
    assert.equal(res.status, 200);
    assert.equal(withoutNext(res.text), plain, query);
  }
  // One reading time per lecture and per book.
  assert.match(plain, /class="rt">[^<]*25 min/);
});

test("a lecture is one page: no depth switch, an old ?depth= link loads it unchanged", async () => {
  const first = await server.request("learn", "GET", "/c-public/l-public");
  assert.equal(first.status, 200);
  const plain = { text: withoutNext(first.text) };
  for (const query of ["?depth=abyss", "?depth=tip", "?depth=nonsense"]) {
    const res = await server.request("learn", "GET", `/c-public/l-public${query}`);
    assert.equal(res.status, 200, query);
    assert.equal(withoutNext(res.text), plain.text, query);
  }
  assert.doesNotMatch(plain.text, /data-depth|data-layer|layer-tag|depth-switch|<html[^>]* data-depth/);
  assert.match(plain.text, /25 min read/);
  assert.match(plain.text, /id="in-brief"/);
  // Version 1 files read as one page: the old Tip first, then Waterline, Deep and Abyss in order.
  const at = (needle: string): number => plain.text.indexOf(needle);
  assert.ok(at("Tip text") > 0 && at("Tip text") < at("Body CANARYPUBLICQQ"));
  assert.ok(at("Body CANARYPUBLICQQ") < at("Deep CANARYPUBLICQQ"));
  assert.ok(at("Deep CANARYPUBLICQQ") < at("Abyss CANARYPUBLICQQ"));
  // "On this page" lists the whole lecture.
  const toc = /<aside class="toc"[\s\S]*?<\/aside>/.exec(plain.text)?.[0] ?? "";
  for (const heading of ["In brief", "Section", "Deeper", "Deepest", "Check yourself"]) {
    assert.ok(toc.includes(heading), `On this page lists ${heading}`);
  }
});

/** A page for `role` at http://learn.test/, behind the same proxy headers every other test sends. */
async function landing(role: string, options: PageOptions = {}): Promise<Page> {
  if (!browser) {
    const executable = findBrowser();
    assert.ok(executable, "no browser");
    browser = await Browser.launch(executable, { host: "learn.test", port: server.port });
  }
  const page = await browser.newPage({
    ...options,
    headers: { "x-forwarded-proto": "https", ...(sessions[role] ? { cookie: sessions[role]! } : {}) },
  });
  await page.goto("http://learn.test/");
  return page;
}

const NO_BROWSER = findBrowser() ? false : "no Chrome, Chromium or Edge found (set PORTFOLIO_TEST_BROWSER)";

/** The selected book's label, as a reader's screen reader says it. */
const frontLabel = "document.querySelector('.names button[aria-current=\"true\"]')?.getAttribute('aria-label') ?? ''";
/** How far a book is turned: 1 for a spine to the reader, about 0 for a cover to the reader. */
const facing = (selector: string): string =>
  `new DOMMatrix(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transform).m11`;

test(
  "in a browser: the books stand on a tape, the one in front shows its cover, a click, an arrow, a key or the capsule brings another forward, the panel opens and closes, and the policy is never broken",
  { skip: NO_BROWSER },
  async () => {
    for (const [role, readable] of Object.entries(READS)) {
      const where = role;
      const page = await landing(role);
      try {
        await page.waitFor("document.querySelectorAll('.names button').length === 3", `${where}: books`);
        // One button per book, named with its number, title, count and lock.
        const labels = await page.evaluate<string[]>(
          "[...document.querySelectorAll('.names button')].map((b) => b.getAttribute('aria-label'))",
        );
        for (const [i, v] of (["public", "members", "friends"] as const).entries()) {
          const label = labels.find((l) => l.startsWith(`0${i + 1}. Course c-${v}.`));
          assert.ok(label, `${where}: a button for c-${v}`);
          assert.equal(/Locked/.test(label), !readable.includes(v), `${where}: label of ${v}`);
        }
        assert.match(labels[0]!, /about 25 minutes/);

        // The tape wraps: pictures of the books fill the width, and none of them can be focused or read.
        const pictures = await page.evaluate<{ n: number; hidden: boolean; focusable: number; front: number }>(`(() => {
          const c = [...document.querySelectorAll('.tb')];
          return { n: c.length, hidden: c.every((e) => e.getAttribute('aria-hidden') === 'true'), focusable: c.filter((e) => e.matches('button, [tabindex], a')).length, front: c.filter((e) => e.classList.contains('is-selected')).length };
        })()`);
        assert.ok(pictures.n >= 6, `${where}: the tape wraps (${pictures.n} pictures of 3 books)`);
        assert.equal(pictures.hidden, true);
        assert.equal(pictures.focusable, 0);
        assert.equal(pictures.front, 1, "one book is in front");

        // One tab stop; the book in front is the first, turned to its cover; the others show their spines.
        await page.settle();
        assert.equal(await page.evaluate("document.querySelectorAll('.names button[tabindex=\"0\"]').length"), 1);
        assert.match(await page.evaluate<string>(frontLabel), /^01\./);
        assert.equal(await page.evaluate("document.querySelector('.names button[tabindex=\"0\"]').getAttribute('aria-current')"), "true");
        assert.ok((await page.evaluate<number>(facing(".tb.is-selected"))) < 0.1, `${where}: the front book is turned`);
        assert.ok((await page.evaluate<number>(facing(".tb:not(.is-selected)"))) > 0.99, `${where}: the others are spines`);
        // The capsule lights the shelf of the book in front.
        assert.equal(await page.evaluate("document.querySelector('.pill[aria-current]').dataset.filter"), "shelf:foundations");

        // The round button brings the next book forward; the capsule follows.
        await page.click('[data-step="1"]');
        await page.waitFor(`/^02\\./.test(${frontLabel})`, `${where}: next`);
        assert.equal(await page.evaluate("document.querySelector('.pill[aria-current]').dataset.filter"), "shelf:systems");
        // A click on a spine brings that book forward.
        await page.settle();
        await page.click('.tb[data-slot="2"] .spine');
        await page.waitFor(`/^03\\./.test(${frontLabel})`, `${where}: a spine`);
        // The keyboard: the arrow keys step, Home goes to the first.
        await page.evaluate("document.querySelector('.names button[aria-current=\"true\"]').focus()");
        await page.press("ArrowLeft");
        await page.waitFor(`/^02\\./.test(${frontLabel})`, `${where}: ArrowLeft`);
        assert.equal(
          await page.evaluate("document.activeElement === document.querySelector('.names button[aria-current=\"true\"]')"),
          true,
          `${where}: focus goes with the book`,
        );
        await page.press("Home");
        await page.waitFor(`/^01\\./.test(${frontLabel})`, `${where}: Home`);
        await page.press("End");
        await page.waitFor(`/^03\\./.test(${frontLabel})`, `${where}: End`);
        // A pill takes the shelf to the first book of its group.
        await page.click('[data-filter="shelf:foundations"]');
        await page.waitFor(`/^01\\./.test(${frontLabel})`, `${where}: capsule`);
        await page.click('[data-filter="shelf:agents"]');
        await page.waitFor(`/^03\\./.test(${frontLabel})`, `${where}: capsule, agents`);
        await page.click('[data-filter="all"]');
        await page.waitFor(`/^01\\./.test(${frontLabel})`, `${where}: capsule, all`);
        // The keys work from anywhere on the page, not only on the shelf.
        await page.evaluate("document.activeElement?.blur()");
        await page.press("ArrowRight");
        await page.waitFor(`/^02\\./.test(${frontLabel})`, `${where}: ArrowRight from the page`);
        await page.press("ArrowLeft");
        await page.waitFor(`/^01\\./.test(${frontLabel})`, `${where}: ArrowLeft from the page`);
        await page.press("End");
        await page.waitFor(`/^03\\./.test(${frontLabel})`, `${where}: End from the page`);
        await page.press("Home");
        await page.waitFor(`/^01\\./.test(${frontLabel})`, `${where}: Home from the page`);
        await page.press("Enter");
        await page.waitFor("!document.querySelector('[data-panel]').hidden", `${where}: Enter opens the front book`);
        await page.press("Escape");
        await page.waitFor("document.querySelector('[data-panel]').hidden", `${where}: Escape closes it`);
        // Every number is readable on its band, and the capsule's options are all readable.
        await page.settle();
        await new Promise((resolve) => setTimeout(resolve, 400));
        const unreadable = await page.evaluate<string[]>(`(() => {
          const lum = (c) => { const [r, g, b] = c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
          const bad = [];
          for (const e of document.querySelectorAll('.s-band')) { const c = getComputedStyle(e); if (ratio(c.color, c.backgroundColor) < 4.5) bad.push('band ' + e.textContent); }
          const page = getComputedStyle(document.body).backgroundColor;
          for (const e of document.querySelectorAll('.pill')) { const c = getComputedStyle(e); const bg = c.backgroundColor === 'rgba(0, 0, 0, 0)' ? page : c.backgroundColor; if (ratio(c.color, bg) < 4.5) bad.push('pill ' + e.textContent); }
          return bad;
        })()`);
        assert.deepEqual(unreadable, [], `${where}: unreadable text`);
        // Nothing is hidden by it.
        assert.equal(await page.evaluate("document.querySelectorAll('.names button').length"), 3);

        // A click on the book in front opens the panel with every lecture as a link; focus goes in.
        await page.settle();
        await page.click(".tb.is-selected .cover");
        await page.waitFor("!document.querySelector('[data-panel]').hidden", `${where}: panel`);
        assert.equal(await page.evaluate("document.querySelector('.names button[aria-current=\"true\"]').getAttribute('aria-expanded')"), "true");
        await page.waitFor("document.activeElement === document.querySelector('[data-panel]')", `${where}: focus`);
        assert.deepEqual(
          await page.evaluate("[...document.querySelectorAll('.panel-body .d-list a')].map((a) => a.getAttribute('href'))"),
          ["/c-public/l-public"],
        );
        assert.equal(await page.evaluate("document.querySelector('.panel-body .d-open').getAttribute('href')"), "/c-public");
        // Escape closes it and gives focus back to the book.
        await page.press("Escape");
        await page.waitFor("document.querySelector('[data-panel]').hidden", `${where}: closed`);
        assert.equal(await page.evaluate("document.activeElement === document.querySelector('.names button[aria-current=\"true\"]')"), true, `${where}: focus returns`);

        // A locked book opens to its stub and a way in; nothing else of it is in the page.
        for (const [i, v] of (["members", "friends"] as const).entries()) {
          if (readable.includes(v)) continue;
          await page.click(`.tb[data-slot="${i + 1}"] .spine`);
          await page.waitFor(`/^0${i + 2}\\./.test(${frontLabel})`, `${where}: ${v} in front`);
          await page.settle();
          await page.click(".tb.is-selected .cover");
          await page.waitFor(`document.querySelector('[data-panel]').getAttribute('aria-label') === 'Course c-${v}'`, `${where}: ${v} panel`);
          const panel = await page.evaluate<string>("document.querySelector('[data-panel]').innerText");
          assert.match(panel, role === "visitor" ? /Sign in to read/ : /Your account cannot read this/);
          assert.equal(
            await page.evaluate("Boolean(document.querySelector('.panel-body .d-open[href=\"/c-" + v + "\"]'))"),
            false,
            "no Open link to a locked course",
          );
          await page.press("Escape");
        }
        const html = await page.evaluate<string>("document.documentElement.outerHTML");
        for (const v of VISIBILITIES) assert.equal(html.includes(SECRET[v]), false, `${where}: canary of ${v}`);

        // Where the reader left off, from the progress the lecture pages keep.
        await page.evaluate("localStorage.setItem('learn-progress', JSON.stringify({ 'c-public/l-public': 'started' }))");
        await page.goto("http://learn.test/");
        await page.waitFor("!document.querySelector('[data-resume]').hidden", `${where}: resume`);
        assert.equal(await page.evaluate("document.querySelector('[data-resume] a').getAttribute('href')"), "/c-public/l-public");
        await page.evaluate("localStorage.clear()");

        // Not one violation of the policy, and not one error.
        assert.deepEqual(await page.reportedViolations(), [], `${where}: policy violations`);
        assert.deepEqual(page.errors, [], `${where}: console errors`);
      } finally {
        await page.close();
      }
    }
  },
);

test(
  "in a browser: the arrows are in view and the closed page does not scroll, at every window height from 700 to 1440, signed in and out",
  { skip: NO_BROWSER },
  async () => {
    for (const role of ["visitor", "friend"]) {
      for (const [width, height] of [[1440, 700], [1440, 800], [1440, 900], [1920, 1080], [2560, 1300], [2560, 1440]] as const) {
        const page = await landing(role, { width, height });
        try {
          await page.waitFor("document.querySelectorAll('.tb').length > 3", "books");
          await page.settle();
          const fit = await page.evaluate<{ arrows: number; scroll: number; inner: number }>(`(() => ({
            arrows: Math.round(document.querySelector('.arrows').getBoundingClientRect().bottom),
            scroll: document.documentElement.scrollHeight,
            inner: innerHeight,
          }))()`);
          assert.ok(fit.arrows <= fit.inner, `${role} ${width}x${height}: the arrows end at ${fit.arrows} of ${fit.inner}`);
          assert.ok(fit.scroll <= fit.inner + 1, `${role} ${width}x${height}: the page is ${fit.scroll} high in a window of ${fit.inner}`);
        } finally {
          await page.close();
        }
      }
    }
  },
);

test(
  "in a browser: a press that comes while the tape is still moving brings forward the book that was under the pointer",
  { skip: NO_BROWSER },
  async () => {
    const page = await landing("friend");
    try {
      await page.waitFor("document.querySelectorAll('.names button').length === 3", "books");
      await page.settle();
      await page.evaluate(`window.__pressed = [];
        document.addEventListener('pointerdown', (e) => window.__pressed.push(e.target.closest?.('.tb')?.dataset.slot ?? ''), true); 1`);
      for (const delay of [0, 60, 200]) {
        // Start a move, and press the spine drawn beside the one that is coming forward.
        await page.click('[data-step="1"]');
        await new Promise((resolve) => setTimeout(resolve, delay));
        const at = await page.evaluate<{ x: number; y: number }>(`(() => {
          const c = [...document.querySelectorAll('.tb')].filter((e) => !e.classList.contains('is-selected'))
            .map((e) => e.querySelector('.spine').getBoundingClientRect()).filter((r) => r.width > 5 && r.left > 0 && r.right < innerWidth);
          const r = c.sort((p, q) => Math.abs(p.left - innerWidth / 2) - Math.abs(q.left - innerWidth / 2))[0];
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await page.evaluate("window.__pressed.length = 0");
        await page.clickAt(at.x, at.y);
        await page.settle();
        const seen = await page.evaluate<string[]>("window.__pressed");
        const front = await page.evaluate<string>("document.querySelector('.tb.is-selected').dataset.slot");
        // What the browser found under the pointer at the press is what was brought forward (or opened, if it was the front one).
        if (seen[0]) assert.equal(front, seen[0], `a press ${delay} ms into a move`);
        await page.evaluate("document.querySelector('[data-panel]').hidden || document.querySelector('[data-panel-close]').click()");
      }
      assert.deepEqual(await page.reportedViolations(), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  },
);

test(
  "in a browser: the cover illustration is on the cover of a book the reader may open, and a locked book is a plain cover with a lock",
  { skip: NO_BROWSER },
  async () => {
    const page = await landing("visitor");
    try {
      await page.waitFor("document.querySelectorAll('.names button').length === 3", "books");
      // After a moment of idle every cover on the tape has been drawn once to a bitmap: this
      // fails if the step that does it produces nothing (it once cut each address short).
      await page.waitFor(
        "[...document.querySelectorAll('.tb:not(.is-gone) .cover')].length >= 3 && [...document.querySelectorAll('.tb:not(.is-gone) .cover')].every((c) => getComputedStyle(c).backgroundImage.startsWith('url(\"data:image/webp'))",
        "every cover drawn once to a bitmap",
        20000,
        "[...document.querySelectorAll('.tb .cover')].map((c) => getComputedStyle(c).backgroundImage.slice(0, 40)).join(' | ')",
      );
      const state = await page.evaluate<Record<string, Record<string, unknown>>>(`(() => {
        const out = {};
        [['c-public', '01'], ['c-members', '02'], ['c-friends', '03']].forEach(([slug, n]) => {
          const book = [...document.querySelectorAll('.tb')].find((b) => b.querySelector('.s-band').textContent === n);
          const cover = book.querySelector('.cover');
          const image = getComputedStyle(cover).backgroundImage;
          out[slug] = {
            image: image.startsWith('url("data:image/svg+xml') || image.startsWith('url("data:image/webp'),
            baked: image.startsWith('url("data:image/webp'),
            art: image.includes('ART-' + slug),
            spineLock: Boolean(book.querySelector('.spine .lock')),
            title: book.querySelector('.s-title').textContent,
            number: book.querySelector('.s-band').textContent,
            ratio: cover.offsetWidth / cover.offsetHeight,
            children: cover.children.length,
          };
        });
        return out;
      })()`);
      for (const slug of ["c-public", "c-members", "c-friends"]) assert.equal(state[slug]!.baked, true, `${slug}: its cover is a bitmap`);
      assert.equal(state["c-public"]!.children, 0, "a cover is one image, with nothing in it");
      assert.ok(Math.abs((state["c-public"]!.ratio as number) - 0.75) < 0.01, "a cover is three quarters as wide as it is tall");
      for (const [slug, n] of [["c-public", "01"], ["c-members", "02"], ["c-friends", "03"]] as const) {
        assert.equal(state[slug]!.number, n);
        assert.equal(state[slug]!.image, true, `${slug}: a cover image`);
      }
      for (const slug of ["c-members", "c-friends"]) {
        assert.equal(state[slug]!.art, false, `${slug}: no illustration for a locked book`);
        assert.equal(state[slug]!.spineLock, true, `${slug}: the lock is on the spine`);
        assert.match(state[slug]!.title as string, /Course c-/, `${slug}: it has its title`);
      }
      // The page, with the locked books in it, holds nothing of what is behind them.
      const html = await page.evaluate<string>("document.documentElement.outerHTML");
      for (const v of VISIBILITIES) assert.equal(html.includes(SECRET[v]), false, `canary of ${v}`);
      assert.equal(html.includes('ART-c-members'), false);
      assert.equal(html.includes('ART-c-friends'), false);
      assert.deepEqual(await page.reportedViolations(), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  },
);

test(
  "in a browser with scripts off, the same page is cards: every course and lecture link is there to read",
  { skip: NO_BROWSER },
  async () => {
    const page = await landing("friend", { javaScript: false });
    try {
      const state = await page.evaluate<{
        buttons: number;
        details: number;
        visible: number;
        lectures: string[];
        filters: string;
        arrows: string;
      }>(`(() => ({
        buttons: document.querySelectorAll(".names button, .tb").length,
        details: document.querySelectorAll(".detail").length,
        visible: [...document.querySelectorAll(".detail")].filter((d) => getComputedStyle(d).display !== "none").length,
        lectures: [...document.querySelectorAll(".detail .d-list a")].map((a) => a.getAttribute("href")),
        filters: getComputedStyle(document.querySelector("[data-filters]")).display,
        arrows: getComputedStyle(document.querySelector("[data-arrows]")).display,
      }))()`);
      assert.equal(state.buttons, 0);
      assert.equal(state.details, 3);
      assert.equal(state.visible, 3, "every card is shown");
      assert.deepEqual(state.lectures.sort(), ["/c-friends/l-friends", "/c-members/l-members", "/c-public/l-public"]);
      assert.equal(state.filters, "none", "the capsule needs a script, so it is not shown");
      assert.equal(state.arrows, "none", "and neither are the round buttons");
      // The cover is a flat picture on the card, not a turned book.
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.vol .spine')).display"), "none");
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.vol .cover')).display"), "block");
      assert.deepEqual(await page.reportedViolations(), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  },
);

test(
  "in a browser asking for reduced motion, the tape changes at once: nothing slides or turns on the way, and there is no ring",
  { skip: NO_BROWSER },
  async () => {
    const page = await landing("visitor", { reducedMotion: true });
    try {
      await page.waitFor("document.querySelectorAll('.names button').length === 3", "books");
      // The front book is turned all the same, and no book has a transition on its move.
      assert.ok((await page.evaluate<number>(facing(".tb.is-selected"))) < 0.1);
      assert.equal(
        await page.evaluate("[...document.querySelectorAll('.tb')].every((b) => getComputedStyle(b).transitionDuration === '0s')"),
        true,
      );
      await page.click('[data-step="1"]');
      await page.waitFor(`/^02\\./.test(${frontLabel})`, "next");
      assert.equal(await page.evaluate("document.getAnimations().length"), 0, "no animation runs");
      assert.equal(await page.evaluate("document.querySelectorAll('.ring').length"), 0, "no ring follows the pointer");
      // The keyboard's book is ringed.
      await page.moveAway();
      await page.evaluate("document.querySelector('.names button[aria-current=\"true\"]').focus()");
      await page.press("ArrowRight");
      await page.waitFor(`/^03\\./.test(${frontLabel})`, "ArrowRight");
      assert.deepEqual(await page.reportedViolations(), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  },
);

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
  // The owner's shell does not have the service's variable: the default name is refused too.
  const unset = u(["add", "admin", "--role", "friend"], PASSWORD, {
    PORTFOLIO_ADMIN_USERNAME: "",
  });
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /environment admin's name/);
  assert.match(
    u(["add", "ADMIN", "--role", "friend"], PASSWORD, { PORTFOLIO_ADMIN_USERNAME: "" })
      .stderr,
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

test("a cover is its own image, from the reader's own catalog: art for a course they may open, a padlock for one they may not, nothing for one they are not told of", async () => {
  for (const [role, readable] of Object.entries(READS)) {
    for (const v of ["public", "members", "friends"] as const) {
      const res = await server.request("learn", "GET", `/covers/c-${v}.svg`, { cookie: sessions[role] });
      const where = `${role} on the cover of ${v}`;
      assert.equal(res.status, 200, where);
      assert.match(String(res.headers["content-type"]), /^image\/svg\+xml/, where);
      assert.match(String(res.headers["cache-control"]), /private/, where);
      assert.match(res.text, /^<svg /, where);
      assert.equal(res.text.includes(`ART-c-${v}`), readable.includes(v), `${where}: the art`);
      for (const secret of VISIBILITIES) assert.equal(res.text.includes(SECRET[secret]), false, `${where}: canary of ${secret}`);
    }
    for (const missing of ["/covers/c-local.svg", "/covers/nope.svg", "/covers/..%2Fc-public.svg", "/covers/c-public.png", "/covers/C-public.svg"]) {
      assert.equal((await server.request("learn", "GET", missing, { cookie: sessions[role] })).status, 404, `${role}: ${missing}`);
    }
  }
});

test("the design page for the books is a route of the dev server only: a build has no trace of it and the lecture host answers 404 for it", async () => {
  for (const path of ["/lab/books", "/lab/books/", "/lab", "/learn/lab/books"]) {
    for (const role of ["visitor", "admin"]) {
      const res = await server.request("learn", "GET", path, { cookie: sessions[role] });
      assert.notEqual(res.status, 200, `${role} on ${path}`);
      assert.doesNotMatch(res.text, /Book lab|lab-grid/, `${role} on ${path}`);
    }
  }
  const site = await server.request("site", "GET", "/learn/lab/books");
  assert.notEqual(site.status, 200);
  assert.doesNotMatch(site.text, /Book lab/);
  const leaked: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/Book lab|lab-grid|src\/lab\/books/.test(readFileSync(path, "latin1"))) leaked.push(path);
    }
  };
  walk(out);
  assert.deepEqual(leaked, [], "nothing of the design page is in the build");
});

// ---------------------------------------------------------------------------
// Headers on every response of the lecture host

const LEARN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; " +
  "img-src 'self' data:; media-src 'self'; font-src 'self' data:; frame-ancestors 'none'; " +
  "base-uri 'none'; object-src 'none'; form-action 'self'";

function assertSealed(res: Response, where: string): void {
  const h = (name: string): string => String(res.headers[name] ?? "");
  assert.equal(h("x-content-type-options"), "nosniff", `${where}: nosniff`);
  assert.equal(h("content-security-policy"), LEARN_CSP, `${where}: CSP`);
  assert.equal(h("x-frame-options"), "DENY", `${where}: framing`);
  assert.match(h("vary"), /(^|,\s*)Cookie(\s*,|$)/i, `${where}: Vary`);
  // A page is private; public media says its own (public, max-age) and is the same for everyone.
  assert.match(h("cache-control"), /private|no-store|^public, max-age=\d+$/, `${where}: cache-control`);
  assert.match(h("referrer-policy"), /strict-origin/, `${where}: referrer`);
  assert.match(h("strict-transport-security"), /max-age=/, `${where}: HSTS on https`);
}

test("every kind of response on the lecture host carries the same headers", async () => {
  const cookie = sessions.friend;
  const kinds: [string, string, string, Parameters<Server["request"]>[3]?][] = [
    ["page 200", "GET", "/c-public/l-public"],
    ["home", "GET", "/"],
    ["course", "GET", "/c-public"],
    ["locked page 403", "GET", "/c-friends/l-friends"],
    ["unknown lecture 404", "GET", "/c-public/nope"],
    ["local lecture 404", "GET", "/c-local/l-local", { cookie }],
    ["unknown path 404", "GET", "/no/such/page/at/all"],
    ["api 404", "GET", "/api/posts"],
    ["api POST 404", "POST", "/api/login", { origin: LEARN }],
    ["bad origin 403", "POST", "/signin", { form: { username: "a", password: "b" } }],
    ["bad origin on sign-out", "POST", "/signout", { origin: "https://evil.test" }],
    ["/learn prefix 301", "GET", "/learn/c-public/l-public"],
    ["/admin redirect 301", "GET", "/admin"],
    ["/blog prefix 301", "GET", "/blog/x"],
    ["sign-in form", "GET", "/signin"],
    ["sign-in redirect 303", "POST", "/signin", {
      form: { username: "nobody", password: "x", next: "/" },
      origin: LEARN,
      headers: freshIp(),
    }],
    ["sign-out redirect", "POST", "/signout", { origin: LEARN }],
    ["search json", "GET", "/search.json?q=idea"],
    ["search page", "GET", "/search?q=idea"],
    ["media 200", "GET", "/media/c-public/l-public.mp4"],
    ["media 206", "GET", "/media/c-public/l-public.mp4", { headers: { range: "bytes=0-3" } }],
    ["media 404", "GET", "/media/c-friends/l-friends.mp4"],
    ["media bad name", "GET", "/media/c-public/..%2f..%2fcourse.md"],
    ["HEAD page", "HEAD", "/c-public/l-public"],
    ["HEAD locked", "HEAD", "/c-friends/l-friends"],
    ["with an unknown cookie", "GET", "/", { cookie: `${COOKIE}=junk` }],
  ];
  for (const [label, method, path, options] of kinds) {
    const res = await server.request("learn", method, path, options);
    assertSealed(res, `${label} (${res.status})`);
  }
  // The main site and the blog do not get the lecture host's policy.
  const site = await server.request("site", "GET", "/healthz");
  assert.equal(site.headers["content-security-policy"], undefined);
  assert.equal(site.headers["x-content-type-options"], "nosniff");
  const blog = await server.request("blog", "GET", "/");
  assert.equal(blog.headers["content-security-policy"], undefined);
});

test("a crash on the lecture host is a bare 500 with the same headers", async () => {
  // A database that cannot be opened: the first request with a session cookie fails inside the middleware.
  const broken = mkdtempSync(join(tmpdir(), "portfolio-dbdir-"));
  const crashing = await start({
    out,
    contentDirs: [library],
    env: { PORTFOLIO_DB_PATH: broken },
    anyAnswer: true,
  });
  try {
    const res = await crashing.request("learn", "GET", "/c-public/l-public", {
      cookie: `${COOKIE}=whatever`,
    });
    assert.equal(res.status, 500);
    assertSealed(res, "500");
    assert.equal(res.text, "Internal Server Error", "nothing of the failure is shown");
    assert.ok(!/at |sqlite|unable to open/i.test(res.text));
  } finally {
    await crashing.stop();
  }
});

test("hosts that are not exactly the lecture host get the main site, never lecture pages", async () => {
  const cookie = sessions.admin;
  for (const host of [
    "LEARN.TEST",
    "Learn.Test",
    "learn.test.",
    "learn.test:443",
    "learn.test:80",
    "learn.test:4321",
    "learn.test%2f",
    "learn.test.evil.test",
    "xlearn.test",
  ]) {
    for (const path of ["/c-public/l-public", "/c-members/l-members", "/signin"]) {
      const res = await server.request("learn", "GET", path, { cookie, headers: { host } });
      assert.ok(!res.text.includes(SECRET.public), `${host} ${path}: lecture text`);
      assert.ok(!res.text.includes(SECRET.members), `${host} ${path}: lecture text`);
      assert.equal(res.headers["content-security-policy"], undefined, `${host} ${path}: not the lecture host`);
      // (A host Astro cannot parse gets the main site's home page, which holds no lecture.)
      assert.ok([200, 301, 400, 404].includes(res.status), `${host} ${path}: ${res.status}`);
    }
  }
  // A forwarded host does not make a request the lecture host's.
  for (const name of ["x-forwarded-host", "forwarded"]) {
    const res = await server.request("site", "GET", "/c-public/l-public", {
      headers: { [name]: name === "forwarded" ? "host=learn.test" : "learn.test" },
    });
    assert.ok(!res.text.includes(SECRET.public), name);
    assert.equal(res.status, 404, name);
  }
});

test("encoded and doubled slashes reach the same checks, not a way round them", async () => {
  const visitor = [
    "//c-members/l-members",
    "/c-members//l-members",
    "/%63-members/l-members",
    "/c-members/%6c-members",
    "/c-members/l-members/",
    "/c-members/l-members?x=1#y",
    "/c-members/l-members%00",
    "/c-members/./l-members",
    "/c-public/../c-members/l-members",
    "/c-public/%2e%2e/c-members/l-members",
    "/C-members/l-members",
    "/media/c-members/l-members.mp4",
    "//media/c-members/l-members.mp4",
    "/media/c-members/l-members.mp4/",
    "/media/c-members/%30%31-l-members.mp4",
    "/media/c-members/..%2f01-l-members.mp4",
    "/media/c-public/..%2fc-members%2f01-l-members.mp4",
    "/media/c-public/%2e%2e/c-members/01-l-members.mp4",
    "/search.json?q=" + SECRET.members,
    "//search.json?q=" + SECRET.members,
  ];
  for (const path of visitor) {
    const res = await server.request("learn", "GET", path);
    assert.ok(!res.text.includes(SECRET.members), `${path}: members canary for a visitor`);
    assert.ok([200, 301, 308, 400, 403, 404].includes(res.status), `${path}: ${res.status}`);
    if (res.status === 200) assertSealed(res, path);
  }
  // Nothing reaches the API, the admin or a local lecture by spelling it differently.
  const cookie = sessions.admin;
  for (const path of [
    "/%61pi/posts",
    "//api/posts",
    "/api//posts",
    "/%2561pi/posts",
    "/%61dmin",
    "//admin",
    "/c-local/l-local",
    "/c%2dlocal/l-local",
    "//c-local/l-local",
    "/c-local//l-local",
    "/%63-local/%6c-local",
    "/media/c-local/l-local.mp4",
    "/media/c-local/%30%31-l-local.mp4",
  ]) {
    for (const cookieHeader of [undefined, cookie]) {
      const res = await server.request("learn", "GET", path, { cookie: cookieHeader });
      assert.ok(!res.text.includes(SECRET.local), `${path}: local canary`);
      assert.ok(!/<title>Admin|admin-shell/i.test(res.text), `${path}: admin page`);
      assert.ok([301, 308, 400, 403, 404].includes(res.status), `${path}: ${res.status}`);
    }
  }
});

test("HEAD answers like GET without a body, and gives nothing GET would not", async () => {
  const cases: [string, string | undefined, number][] = [
    ["/c-public/l-public", undefined, 200],
    ["/c-members/l-members", undefined, 403],
    ["/c-members/l-members", sessions.member, 200],
    ["/c-friends/l-friends", sessions.member, 403],
    ["/c-local/l-local", sessions.admin, 404],
    ["/media/c-members/l-members.mp4", undefined, 404],
    ["/media/c-members/l-members.mp4", sessions.member, 200],
    ["/media/c-local/l-local.mp4", sessions.admin, 404],
    ["/search.json?q=" + SECRET.members, undefined, 200],
  ];
  for (const [path, cookie, status] of cases) {
    const get = await server.request("learn", "GET", path, { cookie });
    const head = await server.request("learn", "HEAD", path, { cookie });
    assert.equal(get.status, status, `GET ${path}`);
    assert.equal(head.status, status, `HEAD ${path}`);
    assert.equal(head.text, "", `HEAD ${path}: no body`);
    assertSealed(head, `HEAD ${path}`);
    for (const secret of Object.values(SECRET)) {
      assert.ok(!JSON.stringify(head.headers).includes(secret), `HEAD ${path}: ${secret}`);
    }
  }
  // Other methods are not a way in either.
  for (const method of ["OPTIONS", "PUT", "DELETE", "PATCH"]) {
    const res = await server.request("learn", method, "/c-members/l-members", {
      origin: LEARN,
    });
    assert.ok(!res.text.includes(SECRET.members), method);
    assert.notEqual(res.status, 200, method);
  }
});

// ---------------------------------------------------------------------------
// Throttling and the client address

const wrong = (ip: string, name = "nobody") =>
  server.request("learn", "POST", "/signin", {
    form: { username: name, password: "wrong", next: "/" },
    origin: LEARN,
    headers: { "x-forwarded-for": ip },
  });

const signInFrom = (ip: string, name: string, password = PASSWORD) =>
  server.request("learn", "POST", "/signin", {
    form: { username: name, password, next: "/" },
    origin: LEARN,
    headers: { "x-forwarded-for": ip },
  });

test("failures from other addresses cannot lock a user out: a correct password from a clean address is never refused", async () => {
  server.user(["add", "victim", "--role", "friend"], { password: PASSWORD });
  for (const name of ["victim", OWNER.username]) {
    // An attacker with many addresses, five wrong passwords each.
    for (let a = 1; a <= 12; a++) {
      for (let i = 0; i < 5; i++) await wrong(`203.0.113.${a}`, name);
    }
    const attacker = await signInFrom("203.0.113.1", name, name === "victim" ? PASSWORD : OWNER.password);
    assert.match(String(attacker.headers.location), /locked/, `${name}: the attacker's own address`);
    const owner = await signInFrom("198.51.100.250", name, name === "victim" ? PASSWORD : OWNER.password);
    assert.ok(owner.cookies.some((c) => c.startsWith(`${COOKIE}=`)), `${name}: signed in from a clean address`);
    assert.doesNotMatch(String(owner.headers.location), /locked|failed/);
  }
});

test("an IPv6 client is throttled as a /64, not as one of 2^64 addresses", async () => {
  for (let i = 1; i <= 5; i++) await wrong(`2001:db8:aaaa:bbbb:${i}::${i}`);
  // Another address of the same /64: locked, though it never failed.
  const same = await signInFrom("2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff", ACCOUNTS.friend);
  assert.match(String(same.headers.location), /locked/);
  // A neighbouring /64 is a different client.
  const other = await signInFrom("2001:db8:aaaa:cccc::1", ACCOUNTS.friend);
  assert.ok(other.cookies.some((c) => c.startsWith(`${COOKIE}=`)));
});

test("how many proxy hops are trusted is a setting: two hops read the second entry from the right, zero ignores the header", async () => {
  const two = await start({ out, contentDirs: [library], env: { PORTFOLIO_TRUSTED_PROXY_HOPS: "2" } });
  const zero = await start({ out, contentDirs: [library], env: { PORTFOLIO_TRUSTED_PROXY_HOPS: "0" } });
  try {
    const attempt = (s: Server, forwarded: string) =>
      s.request("learn", "POST", "/signin", {
        form: { username: "nobody", password: "wrong", next: "/" },
        origin: LEARN,
        headers: { "x-forwarded-for": forwarded },
      });
    // Two hops: the client is the second from the right. Whatever the client puts at the left is its own forgery.
    for (let i = 0; i < 5; i++) await attempt(two, `10.9.9.${i}, 203.0.113.5, 192.0.2.1`);
    const locked = await attempt(two, "10.7.7.7, 203.0.113.5, 192.0.2.1");
    assert.match(String(locked.headers.location), /locked/, "same client, rotating forgeries");
    const other = await attempt(two, "10.7.7.7, 203.0.113.6, 192.0.2.1");
    assert.match(String(other.headers.location), /failed/, "another client behind the same proxies");
    // Zero hops: the header means nothing, so rotating it does not help, and nobody is locked by it either.
    for (let i = 0; i < 5; i++) await attempt(zero, `198.51.100.${i}`);
    const shared = await attempt(zero, "198.51.100.200");
    assert.match(String(shared.headers.location), /locked/, "all of it came from the one peer");
  } finally {
    await two.stop();
    await zero.stop();
  }
});

// ---------------------------------------------------------------------------
// Content that is not to be trusted, and content that is broken

const library2 = mkdtempSync(join(tmpdir(), "portfolio-library2-"));
const HOSTILE_HTML =
  '<script>window.pwned=1</script><img src="x" onerror="window.pwned=2">' +
  '<a href="javascript:window.pwned=3">click</a><iframe src="https://evil.test"></iframe>' +
  '<p style="position:fixed;inset:0" onclick="window.pwned=4">overlay</p>' +
  "<details open ontoggle=\"window.pwned=5\"><summary>Fine</summary>kept</details>";

function hostileLibrary(): void {
  writeLibrary(library2, visibilityLibrary().slice(0, 2));
  const dir = join(library2, "c-public");
  const lecture = (order: number, slug: string, secret: string): string =>
    lectureMarkdown("c-public", { order, slug, title: `Lecture ${slug}`, visibility: "public", secret });
  // Raw HTML that tries everything, in a lecture that is otherwise valid.
  writeFileSync(
    join(dir, "02-hostile.md"),
    lecture(2, "hostile", "CANARYHOSTILEQQ").replace("Body ", `${HOSTILE_HTML}\n\nBody `),
  );
  writeFileSync(join(dir, "02-hostile.mp4"), "VIDEO");
  // A diagram with a script in it: the lecture is left out, the rest is served.
  mkdirSync(join(dir, "diagrams"), { recursive: true });
  writeFileSync(
    join(dir, "diagrams", "02-evil.svg"),
    DIAGRAM.replace("</svg>", "<script>window.pwned=6</script></svg>").replace("<svg ", '<svg onload="window.pwned=7" '),
  );
  writeFileSync(
    join(dir, "03-evil-diagram.md"),
    lecture(3, "evil-diagram", "CANARYEVILQQ").replace("![[diagram: 01-d", "![[diagram: 02-evil"),
  );
  // A file that is not a lecture at all.
  writeFileSync(join(dir, "04-broken.md"), "this is not a lecture\n");
  // A course whose own file is broken.
  mkdirSync(join(library2, "c-gone"), { recursive: true });
  writeFileSync(join(library2, "c-gone", "course.md"), "---\nslug: [\n---\n");
}

test("hostile HTML in a lecture is made harmless, and a hostile diagram is refused at load", async () => {
  hostileLibrary();
  const hostile = await start({ out, contentDirs: [library2] });
  try {
    const page = await hostile.request("learn", "GET", "/c-public/hostile");
    assert.equal(page.status, 200);
    assertSealed(page, "hostile lecture");
    for (const pattern of [
      /<script>/i,
      /<script(?![^>]*\bsrc="\/_astro\/)/i,
      /onerror/i,
      /onclick/i,
      /ontoggle/i,
      /javascript:/i,
      /<iframe/i,
      /evil\.test/,
      /position:fixed/,
      /pwned=/,
    ]) {
      assert.doesNotMatch(page.text, pattern, String(pattern));
    }
    // What was legitimate in it is kept.
    assert.match(page.text, /<details open="">?<summary>Fine<\/summary>kept<\/details>|<details open><summary>Fine<\/summary>kept<\/details>/);
    assert.ok(page.text.includes("CANARYHOSTILEQQ"));

    // The lecture with the hostile diagram is not served, and its text is nowhere.
    const evil = await hostile.request("learn", "GET", "/c-public/evil-diagram");
    assert.equal(evil.status, 404);
    assert.ok(!evil.text.includes("CANARYEVILQQ"));
    const everything = (await hostile.request("learn", "GET", "/c-public")).text;
    assert.ok(!everything.includes("evil-diagram"));
    assert.ok(!everything.includes("window.pwned"));
  } finally {
    await hostile.stop();
  }
});

test("one broken file does not take the lecture host down: the rest is served, the log says what was left out, only the admin is told", async () => {
  hostileLibrary();
  const broken = await start({ out, contentDirs: [library2] });
  try {
    broken.user(["add", "root2", "--role", "admin"], { password: PASSWORD });
    const login = await broken.request("learn", "POST", "/signin", {
      form: { username: "root2", password: PASSWORD, next: "/" },
      origin: LEARN,
      headers: freshIp(),
    });
    const admin = login.cookies.find((c) => c.startsWith(`${COOKIE}=`))!.split(";")[0]!;

    // Public lectures keep working, and so do the other pages.
    for (const path of ["/", "/c-public", "/c-public/l-public", "/c-members", "/signin", "/search.json?q=idea", "/sitemap.xml"]) {
      const res = await broken.request("learn", "GET", path);
      assert.ok(res.status === 200 || res.status === 404, `${path}: ${res.status}`);
      assert.notEqual(res.status, 500, path);
    }
    assert.equal((await broken.request("learn", "GET", "/c-public/l-public")).status, 200);
    assert.equal((await broken.request("learn", "GET", "/c-members/l-members")).status, 403);

    // Visitors are told nothing; the admin gets a count, and the detail stays in the log.
    const visitor = await broken.request("learn", "GET", "/c-public");
    assert.doesNotMatch(visitor.text, /load-notice|04-broken|could not be loaded/);
    const notice = await broken.request("learn", "GET", "/c-public", { cookie: admin });
    assert.match(notice.text, /class="load-notice"/);
    assert.match(notice.text, /\b\d+ files? (was|were) left out; see the server log/);
    assert.doesNotMatch(notice.text, /04-broken|03-evil-diagram|c-gone|<pre>/);
    // A member is not the admin.
    broken.user(["add", "mem2", "--role", "member"], { password: PASSWORD });
    const m = await broken.request("learn", "POST", "/signin", {
      form: { username: "mem2", password: PASSWORD, next: "/" },
      origin: LEARN,
      headers: freshIp(),
    });
    const member = m.cookies.find((c) => c.startsWith(`${COOKIE}=`))!.split(";")[0]!;
    assert.doesNotMatch(
      (await broken.request("learn", "GET", "/c-public", { cookie: member })).text,
      /load-notice|04-broken/,
    );

    // Each bad file is logged, loudly.
    const log = broken.stderr();
    assert.match(log, /LEFT OUT/);
    assert.match(log, /04-broken\.md/);
    assert.match(log, /03-evil-diagram\.md/);
    assert.match(log, /c-gone/);
  } finally {
    await broken.stop();
  }
});

test("changing the environment admin's password ends its sessions", async () => {
  const first = await start({ out, contentDirs: [library] });
  const cookies: { learn: string; admin: string } = { learn: "", admin: "" };
  try {
    const learn = await first.request("learn", "POST", "/signin", {
      form: { username: OWNER.username, password: OWNER.password, next: "/" },
      origin: LEARN,
      headers: freshIp(),
    });
    cookies.learn = learn.cookies.find((c) => c.startsWith(`${COOKIE}=`))!.split(";")[0]!;
    const blog = await first.request("blog", "POST", "/api/login", {
      form: { username: OWNER.username, password: OWNER.password, next: "/admin" },
      origin: BLOG,
      headers: freshIp(),
    });
    cookies.admin = blog.cookies.find((c) => c.startsWith("portfolio_session="))!.split(";")[0]!;
    assert.equal((await first.request("learn", "GET", "/c-friends/l-friends", { cookie: cookies.learn })).status, 200);
    assert.equal((await first.request("blog", "GET", "/admin", { cookie: cookies.admin })).status, 200);

    // The same database, the same password: still signed in after a restart.
    await first.stop();
    const same = await start({ out, contentDirs: [library], stateDir: first.stateDir, env: {
      PORTFOLIO_ADMIN_PASSWORD_HASH: hashPassword(OWNER.password),
    } });
    try {
      // A new hash of the same words has a new salt: that counts as a new password too.
      assert.equal((await same.request("learn", "GET", "/c-friends/l-friends", { cookie: cookies.learn })).status, 403);
      assert.equal((await same.request("blog", "GET", "/admin", { cookie: cookies.admin })).status, 303);
    } finally {
      await same.stop();
    }
  } finally {
    await first.stop();
  }
});

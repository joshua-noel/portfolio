import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWNER, build, start, type Response, type Server } from "./helpers/server.ts";
import { DIAGRAM, courseMarkdown, lectureMarkdown } from "./helpers/fixtures.ts";
import { GOOD_NEXT, HOSTILE_NEXT } from "./helpers/redirects.ts";

/**
 * What the second review found by running requests against a built copy:
 * an open redirect, a load notice that leaked `local` text and server paths,
 * media URLs that showed a hidden lecture's number, a reload that stopped
 * every host, a 500 for a body that is not a form, and responses that
 * skipped the security headers.
 */
if (process.env.PORTFOLIO_SKIP_E2E) process.exit(0);

const LEARN = "https://learn.test";
const COOKIE = "__Host-learn_session";
const PASSWORD = "correct horse battery";

const library = mkdtempSync(join(tmpdir(), "portfolio-sweep-library-"));
let out: string;
let server: Server;
let launcher: Server;
const sessions: Record<string, string> = {};

let ip = 0;
const fresh = (): Record<string, string> => ({
  "x-forwarded-for": `198.51.100.${(ip = (ip % 250) + 1)}`,
});

/** A valid lecture that says its own canary everywhere. */
function lecture(
  order: number,
  slug: string,
  visibility: string,
  secret: string,
  edit: (text: string) => string = (text) => text,
): string {
  return edit(
    lectureMarkdown("alpha", { order, slug, title: `Lecture ${slug}`, visibility, secret }),
  );
}

const LOCAL_WORDS = [
  "CNRYLOCALNOTES",
  "CNRYBROKENPROM",
  "CNRYMISMATCHFM",
  "local-notes",
  "local-broken",
  "local-mismatch",
  "localcourse",
  "localgone",
  "07-local-prereq",
];

function writeFixtures(): void {
  const dir = join(library, "alpha");
  mkdirSync(join(dir, "diagrams"), { recursive: true });
  writeFileSync(
    join(dir, "course.md"),
    courseMarkdown("alpha", "foundations", 1, "public", "CNRYCOURSE"),
  );
  writeFileSync(
    join(dir, "diagrams", "01-d.svg"),
    `<svg viewBox="0 0 10 10"><title>T</title><desc>D</desc><rect width="5" height="5" fill="var(--c1)"/></svg>`,
  );
  const files: [string, string][] = [
    ["01-pub-one.md", lecture(1, "pub-one", "public", "CNRYPUBONE")],
    // Hidden on a server: valid, but local.
    ["02-local-notes.md", lecture(2, "local-notes", "local", "CNRYLOCALNOTES")],
    ["03-mem-three.md", lecture(3, "mem-three", "members", "CNRYMEMTHREE")],
    // Public, with video and a prerequisite that is a local lecture.
    [
      "04-pub-four.md",
      lecture(4, "pub-four", "public", "CNRYPUBFOUR", (t) =>
        t.replace("prerequisites: []", "prerequisites: [local-notes]"),
      ),
    ],
    // Local, and broken in the way that quotes its own text back in the error.
    [
      "05-local-broken.md",
      lecture(5, "local-broken", "local", "CNRYBROKEN", (t) =>
        t.replace(
          "promise: Promise of Lecture local-broken.",
          "promise: CNRYBROKENPROM the plan: phase: two",
        ),
      ),
    ],
    // Local, with a front matter slug that does not match its file name.
    [
      "06-local-mismatch.md",
      lecture(6, "local-mismatch", "local", "CNRYMISMATCH", (t) =>
        t.replace("slug: local-mismatch", "slug: CNRYMISMATCHFM"),
      ),
    ],
    ["07-pub-seven.md", lecture(7, "pub-seven", "public", "CNRYPUBSEVEN")],
  ];
  for (const [name, text] of files) writeFileSync(join(dir, name), text);
  // Video, captions and a poster for the two public lectures that have video.
  for (const stem of ["01-pub-one", "04-pub-four", "07-pub-seven"]) {
    writeFileSync(join(dir, `${stem}.mp4`), `VIDEO ${stem}`);
    writeFileSync(join(dir, `${stem}.vtt`), `WEBVTT\n\n00:00.000 --> 00:01.000\n${stem}\n`);
    writeFileSync(join(dir, `${stem}.poster.png`), `POSTER ${stem}`);
  }
  // A whole local course, with a course file whose slug does not match its folder.
  const gone = join(library, "localgone");
  mkdirSync(gone, { recursive: true });
  writeFileSync(
    join(gone, "course.md"),
    courseMarkdown("not-localgone", "special", 1, "local", "CNRYLOCALCOURSE"),
  );
  // A local course that is fine.
  const lc = join(library, "localcourse");
  mkdirSync(lc, { recursive: true });
  writeFileSync(join(lc, "course.md"), courseMarkdown("localcourse", "special", 2, "local", "CNRYLC"));
}

async function signIn(s: Server, username: string, password: string): Promise<string> {
  const res = await s.request("learn", "POST", "/signin", {
    form: { username, password, next: "/" },
    origin: LEARN,
    headers: fresh(),
  });
  return res.cookies.find((c) => c.startsWith(`${COOKIE}=`))?.split(";")[0] ?? "";
}

before(async () => {
  writeFixtures();
  out = build({ PORTFOLIO_LEARN_CONTENT_DIRS: library });
  server = await start({ out, contentDirs: [library] });
  for (const [name, role] of [
    ["mem", "member"],
    ["fri", "friend"],
    ["dbadm", "admin"],
  ] as const) {
    assert.equal(server.user(["add", name, "--role", role], { password: PASSWORD }).status, 0);
  }
  sessions.visitor = "";
  sessions.member = await signIn(server, "mem", PASSWORD);
  sessions.friend = await signIn(server, "fri", PASSWORD);
  sessions.dbAdmin = await signIn(server, "dbadm", PASSWORD);
  sessions.envAdmin = await signIn(server, OWNER.username, OWNER.password);
  launcher = await start({ out, contentDirs: [library], viaLauncher: true });
});

after(async () => {
  await server?.stop();
  await launcher?.stop();
});

// ---------------------------------------------------------------------------
// P2-1: the open redirect

const locationOf = (res: Response): string => String(res.headers.location ?? "");

/** A Location that can only stay on the site: one slash, then not a slash or a backslash. */
function staysHere(location: string): boolean {
  return (
    /^\/(?![/\\])/.test(location) &&
    !/[\\\u0000-\u001f]/.test(location) &&
    new URL(location, LEARN).origin === LEARN
  );
}

test("next cannot take a reader off the site: sign-in, sign-out and the Continue link", async () => {
  for (const value of HOSTILE_NEXT) {
    const where = JSON.stringify(value).slice(0, 60);
    // Sign-in succeeds, and then redirects.
    const signedIn = await server.request("learn", "POST", "/signin", {
      form: { username: "mem", password: PASSWORD, next: value },
      origin: LEARN,
      headers: fresh(),
    });
    if (signedIn.status === 413) continue; // the size limit, with no Location at all
    assert.equal(signedIn.status, 303, where);
    assert.ok(staysHere(locationOf(signedIn)), `sign-in ${where} -> ${locationOf(signedIn)}`);
    // That session is a fresh one for this value: the pages below are the signed-in ones.
    const cookie = signedIn.cookies.find((c) => c.startsWith(`${COOKIE}=`))!.split(";")[0]!;
    // Sign-in fails, and the failure page carries `next` along.
    const failed = await server.request("learn", "POST", "/signin", {
      form: { username: "mem", password: "wrong", next: value },
      origin: LEARN,
      headers: fresh(),
    });
    assert.ok(staysHere(locationOf(failed)), `failure ${where} -> ${locationOf(failed)}`);
    const failedNext = new URL(locationOf(failed), LEARN).searchParams.get("next") ?? "/";
    assert.ok(staysHere(failedNext), `failure next ${where} -> ${failedNext}`);
    // The signed-in sign-in page: the Continue link and the hidden field.
    const page = await server.request(
      "learn",
      "GET",
      `/signin?next=${encodeURIComponent(value)}`,
      { cookie },
    );
    assert.match(page.text, /Continue/, `${where}: this is the signed-in page`);
    for (const [, href] of page.text.matchAll(/<a[^>]*href="([^"]*)"[^>]*>Continue/g)) {
      const decoded = href!.replaceAll("&amp;", "&");
      assert.ok(staysHere(decoded), `Continue ${where} -> ${decoded}`);
    }
    for (const [, hidden] of page.text.matchAll(/name="next"[^>]*value="([^"]*)"/g)) {
      assert.ok(staysHere(hidden!.replaceAll("&amp;", "&")), `hidden ${where} -> ${hidden}`);
    }
    // Sign-out, last: it ends the session.
    const out = await server.request("learn", "POST", "/signout", {
      form: { next: value },
      origin: LEARN,
      cookie,
    });
    assert.ok(staysHere(locationOf(out)), `sign-out ${where} -> ${locationOf(out)}`);
  }
  // The review's exact request, as a signed-in member.
  const member = await signIn(server, "mem", PASSWORD);
  const reviewed = await server.request("learn", "GET", "/signin?next=%2F..%2F%2Fevil.test%2Fphish", {
    cookie: member,
  });
  assert.match(reviewed.text, /Continue/);
  assert.match(reviewed.text, /<a[^>]*href="\/"[^>]*>Continue/);
  assert.doesNotMatch(reviewed.text, /href="\/\/evil\.test/);
});

test("a next that is fine still works, resolved", async () => {
  for (const [value, expected] of GOOD_NEXT) {
    const res = await server.request("learn", "POST", "/signin", {
      form: { username: "mem", password: PASSWORD, next: value },
      origin: LEARN,
      headers: fresh(),
    });
    assert.equal(locationOf(res), expected, value);
  }
});

// ---------------------------------------------------------------------------
// P2-2: the load notice

const ROLES = ["visitor", "member", "friend", "dbAdmin", "envAdmin"] as const;

test("no role is ever shown local text, local names or a server path, even with broken local files", async () => {
  const paths = [
    "/",
    "/alpha",
    "/alpha/pub-one",
    "/alpha/pub-four",
    "/alpha/mem-three",
    "/alpha/local-notes",
    "/alpha/local-broken",
    "/localcourse",
    "/localgone",
    "/search",
    "/search.json?q=CNRYLOCALNOTES",
    "/search.json?q=plan",
    "/sitemap.xml",
    "/robots.txt",
    "/signin",
    "/nope",
  ];
  const leaks = [...LOCAL_WORDS, library, library.replaceAll("\\", "/"), "portfolio-sweep-library", "prerequisite"];
  for (const role of ROLES) {
    const cookie = sessions[role];
    for (const path of paths) {
      const res = await server.request("learn", "GET", path, { cookie });
      // A page that says what was asked for (the 404, the Sign in link's `next`) echoes the path.
      let everything = res.text + JSON.stringify(res.headers);
      for (const echo of [path, encodeURIComponent(path), encodeURIComponent(encodeURIComponent(path))]) {
        everything = everything.replaceAll(echo, "");
      }
      for (const leak of leaks) {
        assert.ok(!everything.includes(leak), `${role} ${path}: "${leak}"`);
      }
    }
  }
});

test("an admin is told how many files were left out, and nothing more; the log has the detail", async () => {
  for (const role of ["dbAdmin", "envAdmin"] as const) {
    const page = await server.request("learn", "GET", "/alpha", { cookie: sessions[role] });
    assert.match(page.text, /class="load-notice"/, role);
    assert.match(page.text, /\b\d+ files? (was|were) left out; see the server log/, role);
    assert.doesNotMatch(page.text, /\.md\b|<pre>|Nested mappings|front matter/, role);
  }
  for (const role of ["visitor", "member", "friend"] as const) {
    const page = await server.request("learn", "GET", "/alpha", { cookie: sessions[role] });
    assert.doesNotMatch(page.text, /load-notice|left out/, role);
  }
  const log = server.stderr();
  assert.match(log, /LEFT OUT/);
  assert.match(log, /05-local-broken\.md/);
  assert.match(log, /CNRYBROKENPROM/);
  assert.match(log, /06-local-mismatch\.md/);
});

test("a public lecture's prerequisite on a local lecture that was left out is not an error", async () => {
  // It is a server: local-notes is not served, so the prerequisite names nothing here, and that is fine.
  assert.doesNotMatch(server.stderr(), /prerequisite "local-notes"/);
  assert.equal((await server.request("learn", "GET", "/alpha/pub-four")).status, 200);
});

// ---------------------------------------------------------------------------
// P3-1: media by slug

test("media is served under the slug, so no URL shows a hidden lecture's number", async () => {
  // Lecture 4 on disk, and Lecture 3 on the page, because 02 is a local lecture that is not there.
  const page = await server.request("learn", "GET", "/alpha/pub-four");
  assert.equal(page.status, 200);
  assert.match(page.text, /Lecture\s*(<!--.*?-->)?\s*3\b/);
  assert.ok(page.text.includes("/media/alpha/pub-four.mp4"));
  assert.ok(page.text.includes("/media/alpha/pub-four.vtt"));
  assert.ok(page.text.includes("/media/alpha/pub-four.poster.png"));
  assert.doesNotMatch(page.text, /\/media\/alpha\/\d\d-/);
  assert.doesNotMatch(page.text, /\b0[2-7]-(pub|local|mem)/);

  for (const [path, body] of [
    ["/media/alpha/pub-four.mp4", "VIDEO 04-pub-four"],
    ["/media/alpha/pub-four.poster.png", "POSTER 04-pub-four"],
  ] as const) {
    const res = await server.request("learn", "GET", path);
    assert.equal(res.status, 200, path);
    assert.equal(res.text, body, path);
  }
  const vtt = await server.request("learn", "GET", "/media/alpha/pub-four.vtt");
  assert.equal(vtt.status, 200);
  assert.match(vtt.text, /04-pub-four/);
  const range = await server.request("learn", "GET", "/media/alpha/pub-four.mp4", {
    headers: { range: "bytes=0-4" },
  });
  assert.equal(range.status, 206);
  assert.equal(range.text, "VIDEO");

  // The numbered names are not URLs any more.
  for (const old of [
    "/media/alpha/04-pub-four.mp4",
    "/media/alpha/04-pub-four.vtt",
    "/media/alpha/04-pub-four.poster.png",
    "/media/alpha/03-pub-four.mp4",
    "/media/alpha/01-pub-one.mp4",
  ]) {
    assert.equal((await server.request("learn", "GET", old)).status, 404, old);
  }
  // A locked lecture's files stay unserved; a local one's never exist.
  assert.equal((await server.request("learn", "GET", "/media/alpha/mem-three.mp4")).status, 404);
  assert.equal((await server.request("learn", "GET", "/media/alpha/local-notes.mp4")).status, 404);
});

test("no page of a visible lecture carries a number that shows the gap", async () => {
  for (const slug of ["pub-one", "pub-four", "pub-seven"]) {
    for (const role of ROLES) {
      const res = await server.request("learn", "GET", `/alpha/${slug}`, { cookie: sessions[role] });
      assert.doesNotMatch(res.text, /\/media\/alpha\/\d{2}-/, `${role} ${slug}`);
    }
  }
  // Lecture 7 on disk, 4 on the page.
  const seven = await server.request("learn", "GET", "/alpha/pub-seven");
  assert.match(seven.text, /Lecture\s*(<!--.*?-->)?\s*4\b/);
});

// ---------------------------------------------------------------------------
// P3-3: a body that is not a form

test("a sign-in or sign-out with a body that is not a form is a 400 with the headers, not a 500", async () => {
  for (const contentType of ["text/plain", "application/json", "application/octet-stream", undefined]) {
    for (const path of ["/signin", "/signout"]) {
      const res = await rawPost(path, contentType);
      assert.equal(res.status, 400, `${path} as ${contentType}`);
      assert.equal(res.headers["x-content-type-options"], "nosniff", `${path} as ${contentType}`);
      assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.ok(!/Error|at |\.ts/.test(res.text), res.text);
    }
  }
  // A real form still works, and sign-out with no body at all still signs out.
  assert.ok(await signIn(server, "mem", PASSWORD));
  const out = await server.request("learn", "POST", "/signout", { origin: LEARN });
  assert.equal(out.status, 303);
});

function rawPost(path: string, contentType: string | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = '{"username":"mem","password":"x"}';
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        method: "POST",
        path,
        headers: {
          host: "learn.test",
          origin: LEARN,
          "x-forwarded-proto": "https",
          "content-length": String(Buffer.byteLength(body)),
          ...(contentType ? { "content-type": contentType } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
            cookies: [],
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// ---------------------------------------------------------------------------
// P3-4: headers on what the framework answers before the middleware

function raw(s: Server, method: string, path: string, host = "learn.test"): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: s.port,
        method,
        path,
        headers: { host, "x-forwarded-proto": "https" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
            cookies: [],
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("what the framework answers before the middleware still carries the headers, behind the launcher", async () => {
  const asset = readdirSync(join(out, "client", "_astro")).find((f) => f.endsWith(".css"))!;
  const cases: [string, string][] = [
    ["GET", "/alpha/"],
    ["GET", "//"],
    ["GET", "/alpha//pub-one"],
    ["TRACE", "/"],
    ["TRACE", "/alpha/pub-one"],
    ["GET", `/_astro/${asset}`],
    ["HEAD", `/_astro/${asset}`],
    ["GET", "/_astro/no-such-file.js"],
  ];
  for (const [method, path] of cases) {
    const res = await raw(launcher, method, path);
    const where = `${method} ${path} (${res.status})`;
    assert.equal(res.headers["x-content-type-options"], "nosniff", where);
    assert.equal(res.headers["x-frame-options"], "DENY", where);
    assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/, where);
  }
  // Another host's static files are not given the lecture host's policy.
  const other = await raw(launcher, "GET", `/_astro/${asset}`, "site.test");
  assert.equal(other.headers["content-security-policy"], undefined);
  // Static files keep their own caching.
  const cached = await raw(launcher, "GET", `/_astro/${asset}`);
  assert.match(String(cached.headers["cache-control"]), /immutable|max-age/);
  // What cannot be covered: a method Node's parser refuses is answered before any code of ours runs.
  const foo = await raw(launcher, "FOO", "/");
  assert.equal(foo.status, 400);
});

// ---------------------------------------------------------------------------
// P3-2: size limits, seen from outside

test("a lecture over the size limit is refused with a log line, and the host stays up", async () => {
  const big = mkdtempSync(join(tmpdir(), "portfolio-sweep-big-"));
  const dir = join(big, "alpha");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "course.md"), courseMarkdown("alpha", "foundations", 1, "public", "CNRYC"));
  writeFileSync(join(dir, "01-ok.md"), lecture(1, "ok", "public", "CNRYOK"));
  // A sparse 20 MiB file: it costs nothing to make, and must not be read.
  const huge = join(dir, "02-huge.md");
  writeFileSync(huge, lecture(2, "huge", "public", "CNRYHUGE"));
  truncateSync(huge, 20 * 1024 * 1024);
  mkdirSync(join(dir, "diagrams"));
  writeFileSync(join(dir, "diagrams", "01-d.svg"), DIAGRAM);
  const s = await start({ out, contentDirs: [big] });
  try {
    const started = Date.now();
    assert.equal((await s.request("site", "GET", "/healthz")).status, 200);
    assert.equal((await s.request("learn", "GET", "/alpha/ok")).status, 200);
    assert.equal((await s.request("learn", "GET", "/alpha/huge")).status, 404);
    assert.ok(Date.now() - started < 10_000, "a refused file is not read");
    assert.match(s.stderr(), /02-huge\.md.*(over|limit)/is);
  } finally {
    await s.stop();
  }
});

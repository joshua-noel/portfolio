import { test } from "node:test";
import assert from "node:assert/strict";
import { canRead, parseRole, whyLocked } from "../src/lib/access.ts";
import {
  forViewer,
  loadCatalog,
  findCourse,
  findLecture,
  type Catalog,
} from "../src/lib/learn/catalog.ts";
import { search } from "../src/lib/learn/search.ts";
import {
  SECRET,
  sources,
  visibilityLibrary,
  type FixtureCourse,
} from "./helpers/fixtures.ts";

// What each reader may open, written out by hand rather than computed, so the
// function under test is not checked against itself.
const READS: Record<string, string[]> = {
  visitor: ["public"],
  member: ["public", "members"],
  friend: ["public", "members", "friends"],
  admin: ["public", "members", "friends"],
};
const ROLE = (name: string): string | undefined =>
  name === "visitor" ? undefined : name;

test("canRead: every role against every visibility", () => {
  for (const [name, allowed] of Object.entries(READS)) {
    for (const visibility of ["public", "members", "friends", "local"]) {
      assert.equal(
        canRead(visibility, ROLE(name)),
        allowed.includes(visibility),
        `${name} on ${visibility}`,
      );
    }
  }
});

test("canRead denies by default: unknown visibilities and roles", () => {
  for (const visibility of [
    undefined,
    null,
    "",
    "Public",
    "PUBLIC",
    "private",
    "secret",
    1,
    {},
    ["public"],
  ]) {
    assert.equal(
      canRead(visibility, "admin"),
      visibility === "public",
      String(visibility),
    );
  }
  for (const role of ["root", "owner", "Admin", "ADMIN", "", null, 0, {}, ["admin"]]) {
    assert.equal(canRead("members", role), false, String(role));
    assert.equal(canRead("friends", role), false, String(role));
    assert.equal(canRead("public", role), true, String(role));
  }
  assert.equal(parseRole("admin"), "admin");
  assert.equal(parseRole("Admin"), undefined);
});

test("local is never served unless the owner's switch is on, and then to everyone", () => {
  for (const role of [undefined, "member", "friend", "admin"]) {
    assert.equal(canRead("local", role), false);
    assert.equal(canRead("local", role, false), false);
    assert.equal(canRead("local", role, true), true);
  }
  // Only a real boolean true turns it on.
  assert.equal(canRead("local", "admin", "yes" as never), false);
  assert.equal(canRead("local", "admin", 1 as never), false);
});

test("whyLocked says a little and nothing about the content", () => {
  assert.match(whyLocked("members"), /Membership is not open yet/);
  assert.match(whyLocked("friends"), /friends/);
  assert.match(whyLocked("local"), /not available/);
  assert.match(whyLocked("unknown"), /not available/);
});

const load = (courses: FixtureCourse[], allowLocal = false): Promise<Catalog> =>
  loadCatalog({ courses: sources(courses) }, { allowLocal });

test("the loader leaves out local content, and says how much", async () => {
  const full = await load(visibilityLibrary());
  assert.deepEqual(full.courses.map((c) => c.front.slug).sort(), [
    "c-friends",
    "c-members",
    "c-public",
  ]);
  assert.equal(full.localIgnored, 1);
  const withLocal = await load(visibilityLibrary(), true);
  assert.equal(withLocal.courses.length, 4);
  assert.equal(withLocal.localIgnored, 0);
});

test("a local lecture inside a public course is left out too", async () => {
  const library = visibilityLibrary();
  library[0]!.lectures.push({
    order: 2,
    slug: "l-local-inside",
    title: "Hidden",
    visibility: "local",
    secret: SECRET.local,
  });
  const catalog = await load(library);
  assert.deepEqual(
    findCourse(catalog, "c-public")!.lectures.map((l) => l.slug),
    ["l-public"],
  );
  assert.equal(catalog.localIgnored, 2);
});

test("each reader's catalog opens exactly what the table says and stubs the rest", async () => {
  const full = await load(visibilityLibrary());
  for (const [name, allowed] of Object.entries(READS)) {
    const view = forViewer(full, ROLE(name), false);
    assert.equal(view.courses.length, 3, `${name} still sees every course listed`);
    for (const visibility of ["public", "members", "friends"]) {
      const course = findCourse(view, `c-${visibility}`)!;
      const lecture = findLecture(course, `l-${visibility}`)!;
      const open = allowed.includes(visibility);
      assert.equal(course.locked, !open, `${name} ${visibility} course`);
      assert.equal(lecture.locked, !open, `${name} ${visibility} lecture`);
      assert.equal(lecture.segments.length > 0, open);
      assert.equal(course.introHtml.includes(SECRET[visibility as "public"]), open);
      // Listed either way: title and promise.
      assert.equal(lecture.front.title, `Lecture ${visibility}`);
      assert.equal(lecture.front.promise, `Promise of Lecture ${visibility}.`);
    }
  }
});

test("a locked stub carries nothing but its place, title, promise and visibility", async () => {
  const full = await load(visibilityLibrary());
  const view = forViewer(full, undefined, false);
  for (const visibility of ["members", "friends"] as const) {
    const course = findCourse(view, `c-${visibility}`)!;
    const lecture = course.lectures[0]!;
    const json = JSON.stringify({ course, lecture });
    assert.ok(!json.includes(SECRET[visibility]), "the canary is not in the stub");
    assert.deepEqual(lecture.front.objectives, []);
    assert.deepEqual(lecture.front.sources, []);
    assert.deepEqual(lecture.front.minutes, { tip: 0, waterline: 0, deep: 0, abyss: 0 });
    assert.equal(lecture.front.video, false);
    assert.equal(lecture.front.checked, "");
    assert.deepEqual(lecture.segments, []);
    assert.deepEqual(lecture.objectivesHtml, []);
    assert.deepEqual(lecture.toc, []);
    assert.equal(lecture.text, "");
    assert.equal(lecture.file, "");
    assert.deepEqual(lecture.media, { video: false, captions: false });
    assert.equal(course.dir, "", "no path of the server's disk");
    assert.equal(course.introHtml, "");
    // Nothing in the whole catalog of a visitor mentions a locked secret.
    const everything = JSON.stringify(view);
    assert.ok(
      !everything.includes(SECRET[visibility]),
      `${visibility} canary in the visitor's catalog`,
    );
    const stub = JSON.stringify(course);
    assert.ok(!stub.includes("Diagram title"));
    assert.ok(!stub.includes("example.com"));
    assert.ok(!stub.includes("/fixture/"));
  }
});

test("a locked stub does not give away that a local lecture exists", async () => {
  // Lectures 1 (public), 2 (local), 3 (members), 4 (friends) in one course.
  const library = visibilityLibrary().slice(0, 1);
  const lectures = library[0]!.lectures;
  lectures.push(
    { order: 2, slug: "l-notes", title: "Notes", visibility: "local", secret: SECRET.local },
    { order: 3, slug: "l-mem", title: "Mem", visibility: "members", secret: SECRET.members },
    { order: 4, slug: "l-fr", title: "Fr", visibility: "friends", secret: SECRET.friends },
  );
  const full = await load(library);
  const view = forViewer(full, undefined, false);
  const course = findCourse(view, "c-public")!;
  // The numbers a reader sees run 1, 2, 3 with no gap where the local one was.
  assert.deepEqual(
    course.lectures.map((l) => [l.slug, l.front.order]),
    [
      ["l-public", 1],
      ["l-mem", 2],
      ["l-fr", 3],
    ],
  );
  // The same for a reader who may open everything.
  const admin = findCourse(forViewer(full, "admin", false), "c-public")!;
  assert.deepEqual(
    admin.lectures.map((l) => l.front.order),
    [1, 2, 3],
  );
  // The stub says it is locked, and for whom, and has no flag of the lecture behind it.
  const stub = findLecture(course, "l-mem")!;
  assert.equal(stub.locked, true);
  assert.equal(stub.front.visibility, "members");
  assert.equal(stub.front.placeholder, false, "the placeholder flag is not shown");
  // Nothing about the local lecture is anywhere in the visitor's catalog.
  const everything = JSON.stringify(view);
  for (const leak of ["l-notes", "Notes", SECRET.local, '"local"']) {
    assert.ok(!everything.includes(leak), `${leak} in the visitor's catalog`);
  }
  // With the owner's switch on, the real numbers are back.
  const own = findCourse(await load(library, true), "c-public")!;
  assert.deepEqual(
    own.lectures.map((l) => l.front.order),
    [1, 2, 3, 4],
  );
});

test("the stricter of course and lecture wins", async () => {
  const library = visibilityLibrary().slice(0, 1);
  library[0]!.visibility = "friends";
  const full = await load(library);
  const asMember = forViewer(full, "member", false);
  assert.equal(findLecture(findCourse(asMember, "c-public")!, "l-public")!.locked, true);
  const asFriend = forViewer(full, "friend", false);
  assert.equal(findLecture(findCourse(asFriend, "c-public")!, "l-public")!.locked, false);

  // A locked lecture inside an open course.
  const mixed = visibilityLibrary().slice(0, 1);
  mixed[0]!.lectures.push({
    order: 2,
    slug: "l-in",
    title: "Inside",
    visibility: "friends",
    secret: SECRET.friends,
  });
  const view = forViewer(await load(mixed), undefined, false);
  const course = findCourse(view, "c-public")!;
  assert.equal(course.locked, false);
  assert.equal(findLecture(course, "l-public")!.locked, false);
  assert.equal(findLecture(course, "l-in")!.locked, true);
  assert.ok(!JSON.stringify(findLecture(course, "l-in")).includes(SECRET.friends));
});

test("search offers each reader only what they may open", async () => {
  const full = await load(visibilityLibrary());
  for (const [name, allowed] of Object.entries(READS)) {
    const view = forViewer(full, ROLE(name), false);
    for (const visibility of ["public", "members", "friends"] as const) {
      const hits = search(view.lectures, SECRET[visibility]);
      assert.equal(
        hits.length > 0,
        allowed.includes(visibility),
        `${name} searching ${visibility}`,
      );
    }
    // A title is listed anyway, but a locked lecture is not a result.
    assert.deepEqual(
      search(view.lectures, "Lecture")
        .map((h) => h.url)
        .sort(),
      allowed
        .filter((v) => v !== "local")
        .map((v) => `/c-${v}/l-${v}`)
        .sort(),
    );
  }
});

test("a course whose lectures are all locked still stands on its shelf", async () => {
  const view = forViewer(await load(visibilityLibrary()), undefined, false);
  const shelfOf = (slug: string) =>
    view.shelves.find((s) => s.courses.some((c) => c.front.slug === slug))?.id;
  assert.equal(shelfOf("c-members"), "systems");
  assert.equal(shelfOf("c-friends"), "agents");
});

test("the special shelf comes last", async () => {
  const library = visibilityLibrary();
  library[3]!.visibility = "public"; // the special course, readable
  library[3]!.lectures[0]!.visibility = "public";
  const catalog = await load(library);
  assert.equal(catalog.shelves.at(-1)!.id, "special");
  assert.deepEqual(
    catalog.shelves.map((s) => s.id),
    ["foundations", "systems", "agents", "special"],
  );
});

test("two folders merge, and the same course in both is an error naming both", async () => {
  const [a, b] = [
    sources(visibilityLibrary().slice(0, 1)),
    sources(visibilityLibrary().slice(1, 2)),
  ];
  const merged = await loadCatalog({ courses: [...a, ...b] }, { allowLocal: false });
  assert.equal(merged.courses.length, 2);
  const dupe = sources(visibilityLibrary().slice(0, 1));
  dupe[0]!.dir = "/other";
  await assert.rejects(
    loadCatalog({ courses: [...a, ...dupe] }, { allowLocal: false }),
    /two courses named "c-public", in \/fixture\/c-public and \/other/,
  );
});

test("the repository may hold public content only", async () => {
  const members = sources(visibilityLibrary().slice(1, 2));
  await assert.rejects(
    loadCatalog({ courses: members }, { allowLocal: true, repository: true }),
    /"members" course must not be committed/,
  );
  const lecture = visibilityLibrary().slice(0, 1);
  lecture[0]!.lectures[0]!.visibility = "friends";
  await assert.rejects(
    loadCatalog({ courses: sources(lecture) }, { allowLocal: true, repository: true }),
    /"friends" lecture must not be committed/,
  );
  await assert.rejects(
    loadCatalog(
      { courses: sources(visibilityLibrary().slice(3)) },
      { allowLocal: true, repository: true },
    ),
    /"local" course must not be committed/,
  );
});

test("one broken lecture file costs that lecture, not the catalog", async () => {
  const library = visibilityLibrary().slice(0, 2); // c-public and c-members
  const good = sources(library);
  const brokenLecture = {
    path: "c-public/02-broken.md",
    name: "02-broken.md",
    raw: "no front matter here\n",
  };
  good[0]!.lectures.push(brokenLecture);
  // A course whose own file is broken, and a lecture whose formula does not parse.
  good[1]!.course.raw = "---\nslug: [unclosed\n---\n";
  const badMath = {
    path: "c-public/03-math.md",
    name: "03-math.md",
    raw: good[0]!.lectures[0]!.raw
      .replace("slug: l-public", "slug: math")
      .replace("order: 1", "order: 3")
      .replace("Body ", "Bad $\\frac{1}{$ formula "),
  };
  good[0]!.lectures.push(badMath);

  // Strict, as the checker and the tests use it: the first bad file stops everything.
  await assert.rejects(loadCatalog({ courses: good }, { allowLocal: false }));

  // Lenient, as the server uses it: what is valid loads, and each bad file is named.
  const catalog = await loadCatalog(
    { courses: good, problems: ["/gone: cannot be read: ENOENT"] },
    { allowLocal: false, lenient: true },
  );
  assert.deepEqual(
    catalog.courses.map((c) => c.front.slug),
    ["c-public"],
  );
  assert.deepEqual(
    findCourse(catalog, "c-public")!.lectures.map((l) => l.slug),
    ["l-public"],
  );
  const text = catalog.problems.join("\n");
  assert.match(text, /\/gone: cannot be read/);
  assert.match(text, /c-public[\\/]02-broken\.md/);
  assert.match(text, /c-members[\\/]course\.md/);
  assert.match(text, /c-public[\\/]03-math\.md/);
  assert.equal(catalog.problems.length, 4);

  // The public lecture still reads, for a visitor; only an admin is told what is wrong.
  const visitor = forViewer(catalog, undefined, false);
  assert.equal(findLecture(findCourse(visitor, "c-public")!, "l-public")!.locked, false);
  assert.deepEqual(visitor.problems, []);
  assert.equal(visitor.problemCount, 0);
  assert.deepEqual(forViewer(catalog, "friend", false).problems, []);
  assert.equal(forViewer(catalog, "friend", false).problemCount, 0);
  // An admin is told how many, and nothing more: the detail quotes files that may be local, and paths.
  const admin = forViewer(catalog, "admin", false);
  assert.equal(admin.problemCount, 4);
  assert.deepEqual(admin.problems, []);
  assert.ok(!/02-broken|03-math|\/gone|ENOENT/.test(JSON.stringify(admin)), "no file name in what an admin gets");
  // On the owner's own machine (the local switch, a clean loopback request) the detail is shown.
  assert.equal(forViewer(catalog, "admin", true).problems.length, 4);
  assert.deepEqual(forViewer(catalog, "friend", true).problems, []);
});

test("a catalog loaded with local content shows none of it to a request that is not the owner's", async () => {
  const library = visibilityLibrary();
  library[0]!.lectures.push(
    { order: 2, slug: "l-notes", title: "Notes", visibility: "local", secret: SECRET.local },
    { order: 3, slug: "l-after", title: "After", visibility: "members", secret: SECRET.members },
  );
  const full = await load(library, true); // the owner's dev server
  const own = forViewer(full, undefined, true);
  assert.ok(findCourse(own, "c-local"));
  assert.deepEqual(
    findCourse(own, "c-public")!.lectures.map((l) => l.slug),
    ["l-public", "l-notes", "l-after"],
  );
  // The same catalog, for a request through a tunnel: as if it were never loaded.
  for (const role of [undefined, "member", "friend", "admin"]) {
    const view = forViewer(full, role, false);
    assert.equal(findCourse(view, "c-local"), undefined);
    const course = findCourse(view, "c-public")!;
    assert.deepEqual(
      course.lectures.map((l) => [l.slug, l.front.order]),
      [
        ["l-public", 1],
        ["l-after", 2],
      ],
    );
    const everything = JSON.stringify(view);
    for (const leak of ["l-notes", "Notes", SECRET.local, "c-local"]) {
      assert.ok(!everything.includes(leak), `${leak} for ${role}`);
    }
  }
});

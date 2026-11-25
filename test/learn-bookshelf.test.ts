import { test } from "node:test";
import assert from "node:assert/strict";
import { forViewer, loadCatalog, type Catalog } from "../src/lib/learn/catalog.ts";
import {
  buildShelves,
  CASE_MAX_REM,
  caseWidth,
  packCases,
  standingWidth,
  WIDE_SHELF_REM,
  type ShelfView,
} from "../src/lib/learn/bookshelf.ts";
import {
  ALL,
  filterFromKey,
  filterPills,
  filterShelves,
  matchesFilter,
} from "../src/lib/learn/bookshelf-filter.ts";
import {
  contrast,
  coverStyle,
  coverTitleSize,
  heightRem,
  mix,
  NOMINAL_LECTURE_MINUTES,
  spineTitle,
  splitTitle,
  THICKNESS,
  thicknessRem,
} from "../src/lib/learn/cover.ts";
import { MOTIFS, MOTIF_NAMES, resolveMotif } from "../src/lib/learn/motifs.ts";
import { SHELVES } from "../src/lib/learn/lecture.ts";
import {
  SECRET,
  sources,
  visibilityLibrary,
  type FixtureCourse,
} from "./helpers/fixtures.ts";

const load = (courses: FixtureCourse[]): Promise<Catalog> =>
  loadCatalog({ courses: sources(courses) }, { allowLocal: false });

const lecture = (order: number, visibility = "public") => ({
  order,
  slug: `l${order}`,
  title: `Lecture ${order}`,
  visibility,
  secret: SECRET.public,
});

/** Courses on several shelves, handed over in no particular order. */
function library(): FixtureCourse[] {
  const make = (
    slug: string,
    shelf: string,
    order: number,
    n: number,
  ): FixtureCourse => ({
    slug,
    shelf,
    order,
    visibility: "public",
    lectures: Array.from({ length: n }, (_, i) => lecture(i + 1)),
  });
  return [
    make("z-agents", "agents", 1, 2),
    make("b-systems", "systems", 2, 3),
    make("a-systems", "systems", 1, 1),
    make("f-foundations", "foundations", 1, 4),
  ];
}

// ---------------------------------------------------------------------------
// Covers

test("a cover's text is readable on its colour, whatever the colour", () => {
  for (const color of [
    "#000000",
    "#ffffff",
    "#767676",
    "#777777",
    "#757575",
    "#808080",
    "#8a8a8a",
    "#1f3a5f",
    "#e9e2d0",
    "#f2c94c",
    "#7a2e2e",
  ]) {
    const cover = coverStyle({ color, accent: "#e8b84a", motif: "tokens" });
    assert.ok(contrast(cover.ink, cover.color) >= 4.5, `ink on ${color}`);
    assert.ok(contrast(cover.inkSoft, cover.color) >= 4.5, `soft ink on ${color}`);
    assert.ok(
      contrast(cover.mark, cover.color) >= 3 || cover.mark === cover.ink,
      `drawing on ${color}`,
    );
  }
});

test("a cover is made only of hex colours, so nothing else can reach a style attribute", () => {
  const bad = coverStyle({
    color: "red;background:url(x)",
    accent: "#zzzzzz",
    motif: "tokens",
  });
  assert.match(bad.color, /^#[0-9a-f]{6}$/);
  assert.match(bad.accent, /^#[0-9a-f]{6}$/);
  assert.match(bad.ink, /^#[0-9a-f]{6}$/);
  assert.match(bad.inkSoft, /^#[0-9a-f]{6}$/);
  assert.match(bad.mark, /^#[0-9a-f]{6}$/);
  assert.equal(
    coverStyle({ color: "#ABCDEF", accent: "#123456", motif: "grid" }).color,
    "#abcdef",
  );
});

test("mix blends colours", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#ff0000", "#0000ff", 1), "#ff0000");
  assert.equal(mix("#ff0000", "#0000ff", 0), "#0000ff");
});

test("every motif the contract names is drawn, and so is every one the courses use", () => {
  for (const name of [
    "tokens",
    "graph",
    "layers",
    "waves",
    "grid",
    "circuit",
    "orbit",
    "stack",
    "lock",
    "loop",
    // Named by the first five courses.
    "cache",
    "boxes-and-arrows",
    "gradient-steps",
  ]) {
    assert.ok(MOTIFS[name]?.length, `${name} has paths`);
    assert.equal(resolveMotif(name), name);
  }
  for (const [name, paths] of Object.entries(MOTIFS)) {
    for (const d of paths)
      assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/, `${name}: path data`);
  }
});

test("a motif we do not draw still gets one, always the same", () => {
  const first = resolveMotif("something-new");
  assert.ok(MOTIF_NAMES.includes(first));
  assert.equal(resolveMotif("something-new"), first);
  assert.ok(MOTIF_NAMES.includes(resolveMotif("")));
  // Not an inherited property of Object.
  assert.ok(MOTIF_NAMES.includes(resolveMotif("constructor")));
  assert.ok(MOTIF_NAMES.includes(resolveMotif("__proto__")));
});

test("a title with a colon is a title and a subtitle", () => {
  assert.deepEqual(splitTitle("How Language Models Work"), {
    main: "How Language Models Work",
  });
  assert.deepEqual(
    splitTitle("Agent Systems: Tools, Context, Evaluation, and Harnesses"),
    {
      main: "Agent Systems",
      sub: "Tools, Context, Evaluation, and Harnesses",
    },
  );
  assert.deepEqual(splitTitle("Ratio 3:1 matters"), { main: "Ratio 3:1 matters" });
  assert.deepEqual(splitTitle("Trailing: "), { main: "Trailing" });
  assert.deepEqual(splitTitle(": Leading"), { main: ": Leading" });
});

// ---------------------------------------------------------------------------
// Thickness and type

test("thickness grows with reading time inside its limits", () => {
  assert.equal(thicknessRem(0), THICKNESS.min);
  assert.equal(thicknessRem(1e6), THICKNESS.max);
  assert.equal(thicknessRem(-5), THICKNESS.min);
  let last = 0;
  for (let minutes = 0; minutes <= 600; minutes += 10) {
    const t = thicknessRem(minutes);
    assert.ok(t >= last, `${minutes} minutes`);
    assert.ok(t >= THICKNESS.min && t <= THICKNESS.max);
    last = t;
  }
  // Between the limits it is proportional: twice the minutes, twice the spine.
  const a = thicknessRem(180);
  const b = thicknessRem(270);
  assert.ok(a > THICKNESS.min && b < THICKNESS.max);
  assert.ok(Math.abs(b / a - 1.5) < 0.01);
});

test("a spine's height is a small fixed variation of the base", () => {
  assert.equal(heightRem("agent-systems"), heightRem("agent-systems"));
  for (const slug of ["a", "agent-systems", "how-language-models-work", "x".repeat(40)]) {
    const h = heightRem(slug, 16);
    assert.ok(h >= 16 * 0.94 - 0.01 && h <= 16 + 0.01, `${slug}: ${h}`);
  }
});

test("a long title is set smaller or in more lines, never wider than the spine", () => {
  const height = 17;
  for (const title of [
    "Agents",
    "Agent Systems",
    "System Design for Working Engineers",
    "x".repeat(80),
  ]) {
    for (const thickness of [THICKNESS.min, 3.5, THICKNESS.max]) {
      const { size, lines } = spineTitle(title, thickness, height);
      assert.ok(size >= 0.64 && size <= 1.1, `${title}: ${size}`);
      assert.ok(lines >= 1 && lines <= 3);
      if (size > 0.64) {
        assert.ok(
          size * 1.15 * lines <= thickness - 0.9 + 0.01,
          `${title} @ ${thickness}`,
        );
      }
    }
  }
  assert.equal(spineTitle("Agents", 3, 17).lines, 1);
  assert.ok(spineTitle("System Design for Working Engineers", 3, 17).lines >= 2);
  assert.ok(coverTitleSize("Agents") > coverTitleSize("x".repeat(30)));
  assert.ok(coverTitleSize("x".repeat(30)) > coverTitleSize("x".repeat(50)));
});

// ---------------------------------------------------------------------------
// Shelves: order, filters

test("shelves stand in the catalog's order, books in course order, and empty shelves are not drawn", async () => {
  const shelves = buildShelves(await load(library()));
  assert.deepEqual(
    shelves.map((s) => s.id),
    ["foundations", "systems", "agents"],
  );
  assert.deepEqual(
    shelves.map((s) => s.id),
    SHELVES.map((s) => s.id).filter((id) =>
      ["foundations", "systems", "agents"].includes(id),
    ),
  );
  assert.deepEqual(
    shelves[1]!.books.map((b) => b.slug),
    ["a-systems", "b-systems"],
  );
  assert.equal(shelves[1]!.title, "Systems");
  assert.deepEqual(buildShelves(await load([])), []);
});

test("a book is made from its course: counts, links, minutes, thickness from reading time", async () => {
  const [foundations] = buildShelves(await load(library()));
  const book = foundations!.books[0]!;
  assert.equal(book.href, "/f-foundations");
  assert.equal(book.lectures.length, 4);
  assert.deepEqual(
    book.lectures.map((l) => l.href),
    ["/f-foundations/l1", "/f-foundations/l2", "/f-foundations/l3", "/f-foundations/l4"],
  );
  assert.equal(book.videos, 4);
  // The fixture's lectures read 25 minutes each (the four old layers added up).
  assert.equal(book.minutes, 100);
  assert.equal(book.thickness, thicknessRem(4 * 25));
  assert.equal(book.locked, false);
  assert.equal(book.cover.motif, "grid");
});

test("filters: all, one shelf, has video", async () => {
  const library_ = library();
  // One course has no video: a lecture of it is a stub, which says nothing of video.
  const shelves = buildShelves(await load(library_));
  const slugs = (s: ShelfView[]): string[] =>
    s.flatMap((x) => x.books.map((b) => b.slug));
  assert.deepEqual(slugs(filterShelves(shelves, ALL)), slugs(shelves));
  assert.deepEqual(slugs(filterShelves(shelves, { kind: "shelf", id: "systems" })), [
    "a-systems",
    "b-systems",
  ]);
  assert.deepEqual(filterShelves(shelves, { kind: "shelf", id: "frontier" }), []);
  // A shelf left with no book goes; the others keep their order.
  const some = shelves.map((s) => ({
    ...s,
    books: s.books.map((b) => (b.slug === "z-agents" ? { ...b, videos: 0 } : b)),
  }));
  assert.deepEqual(
    filterShelves(some, { kind: "video" }).map((s) => s.id),
    ["foundations", "systems"],
  );
  assert.equal(matchesFilter({ shelf: "x", videos: 0 }, { kind: "video" }), false);
  assert.equal(matchesFilter({ shelf: "x", videos: 2 }, { kind: "video" }), true);
  assert.equal(
    matchesFilter({ shelf: "x", videos: 0 }, { kind: "shelf", id: "x" }),
    true,
  );
  assert.equal(
    matchesFilter({ shelf: "x", videos: 0 }, { kind: "shelf", id: "y" }),
    false,
  );
});

test("the pills are All, the shelves that have books, and Has video when something has", async () => {
  const shelves = buildShelves(await load(library()));
  assert.deepEqual(
    filterPills(shelves).map((p) => p.label),
    ["All", "Foundations", "Systems", "Agents", "Has video"],
  );
  const noVideo = shelves.map((s) => ({
    ...s,
    books: s.books.map((b) => ({ ...b, videos: 0 })),
  }));
  assert.deepEqual(
    filterPills(noVideo).map((p) => p.label),
    ["All", "Foundations", "Systems", "Agents"],
  );
  // Each pill's key finds its filter again.
  for (const pill of filterPills(shelves))
    assert.deepEqual(filterFromKey(pill.key), pill.filter);
  assert.deepEqual(filterFromKey(undefined), ALL);
  assert.deepEqual(filterFromKey("nonsense"), ALL);
});

test("a shelf with more books than half the page holds takes the whole page", async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    slug: `c${i}`,
    shelf: "special",
    order: i + 1,
    visibility: "public",
    lectures: [lecture(1), lecture(2), lecture(3), lecture(4)],
  }));
  const shelves = buildShelves(await load([...library(), ...many]));
  assert.equal(shelves.find((s) => s.id === "special")!.wide, true);
  assert.equal(shelves.find((s) => s.id === "agents")!.wide, false);
  assert.ok(standingWidth([{ thickness: 3 }, { thickness: 3 }]) === 6.125);
  assert.ok(WIDE_SHELF_REM > 10);
});

test("shelves are packed into bookcases in order, as big as fits, and no case is wider than the page", async () => {
  const course = (
    slug: string,
    shelf: string,
    order: number,
    lectures: number,
  ): FixtureCourse => ({
    slug,
    shelf,
    order,
    visibility: "public",
    lectures: Array.from({ length: lectures }, (_, i) => lecture(i + 1)),
  });
  // Five courses on three shelves, as the real library is: one case, the biggest books.
  const five = [
    course("a", "systems", 1, 8),
    course("b", "language-models", 1, 8),
    course("c", "language-models", 2, 7),
    course("d", "language-models", 3, 7),
    course("e", "agents", 1, 10),
  ];
  const real = packCases(buildShelves(await load(five)));
  assert.equal(real.cases.length, 1);
  assert.deepEqual(
    real.cases[0]!.shelves.map((s) => s.id),
    ["systems", "language-models", "agents"],
  );
  assert.equal(real.scale, 1.2);
  assert.equal(real.cases[0]!.scrolls, false);
  assert.deepEqual(packCases([]).cases, []);

  // Thirty books on five shelves: several cases, the shelves still in order, none too wide.
  const thirty = Array.from({ length: 30 }, (_, i) =>
    course(
      `t${i}`,
      ["foundations", "systems", "language-models", "agents", "frontier"][
        Math.floor(i / 6)
      ]!,
      i + 1,
      5,
    ),
  );
  const shelves = buildShelves(await load(thirty));
  const packed = packCases(shelves);
  assert.ok(packed.cases.length > 1 && packed.cases.length < shelves.length);
  assert.deepEqual(
    packed.cases.flatMap((c) => c.shelves.map((s) => s.id)),
    shelves.map((s) => s.id),
  );
  for (const plan of packed.cases) {
    assert.ok(caseWidth(plan.shelves, packed.scale) <= CASE_MAX_REM, "fits the page");
    assert.equal(plan.scrolls, false);
  }

  // One shelf with more books than the page holds has a case to itself, and scrolls.
  const many = Array.from({ length: 24 }, (_, i) => course(`m${i}`, "special", i + 1, 8));
  const wide = packCases(buildShelves(await load([...five, ...many])));
  assert.equal(
    wide.cases
      .at(-1)!
      .shelves.map((s) => s.id)
      .join(),
    "special",
  );
  assert.equal(wide.cases.at(-1)!.scrolls, true);
  // A scrolling case cannot be made bigger: nothing is.
  assert.equal(wide.scale, 1);
  assert.ok(wide.cases.slice(0, -1).every((c) => !c.scrolls));
});

// ---------------------------------------------------------------------------
// Locked: the book says what the stub says

const READS: Record<string, string[]> = {
  visitor: ["public"],
  member: ["public", "members"],
  friend: ["public", "members", "friends"],
  admin: ["public", "members", "friends"],
};

test("a locked book shows only its stub, and no secret reaches the shelf data for anyone", async () => {
  const full = await load(visibilityLibrary());
  for (const [name, readable] of Object.entries(READS)) {
    const role = name === "visitor" ? undefined : name;
    const shelves = buildShelves(forViewer(full, role, false));
    const text = JSON.stringify(shelves);
    for (const visibility of ["public", "members", "friends", "local"] as const) {
      const open = readable.includes(visibility);
      // Titles and promises are the stub; the canary lives in the body, sources and objectives.
      assert.equal(
        text.includes(SECRET[visibility]),
        false,
        `${name}: canary of ${visibility}`,
      );
      const book = shelves
        .flatMap((s) => s.books)
        .find((b) => b.slug === `c-${visibility}`);
      if (visibility === "local") {
        assert.equal(book, undefined, `${name}: no local book`);
        continue;
      }
      assert.ok(book, `${name}: book of ${visibility}`);
      assert.equal(book.locked, !open, `${name} on ${visibility}`);
      if (!open) {
        assert.equal(book.minutes, undefined, "a locked book has no reading time");
        assert.ok(book.why, "it says why");
        assert.equal(book.videos, 0, "and nothing of video");
        for (const l of book.lectures) {
          assert.equal(l.locked, true);
          assert.equal(l.minutes, undefined);
          assert.equal(l.video, false);
          assert.equal(l.placeholder, false);
        }
        // It still stands on the shelf, as thick as a course of typical lectures.
        assert.equal(
          book.thickness,
          thicknessRem(book.lectures.length * NOMINAL_LECTURE_MINUTES),
        );
      } else {
        assert.ok(book.minutes);
        assert.equal(book.why, undefined);
      }
    }
  }
});

test("a lecture the reader may not open inside a course they may is locked on its own", async () => {
  const course: FixtureCourse = {
    slug: "mixed",
    shelf: "systems",
    order: 1,
    visibility: "public",
    lectures: [lecture(1), lecture(2, "members")],
  };
  const catalog = forViewer(await load([course]), undefined, false);
  const [book] = buildShelves(catalog)[0]!.books;
  assert.equal(book!.locked, false);
  assert.deepEqual(
    book!.lectures.map((l) => l.locked),
    [false, true],
  );
  // Only the lecture they can open counts toward the reading time.
  assert.equal(book!.minutes, 25);
  assert.equal(book!.videos, 1);
  assert.equal(JSON.stringify(book).includes(SECRET.members), false);
});

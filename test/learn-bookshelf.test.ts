import { test } from "node:test";
import assert from "node:assert/strict";
import { forViewer, loadCatalog, type Catalog } from "../src/lib/learn/catalog.ts";
import { buildShelves } from "../src/lib/learn/bookshelf.ts";
import { filterPills, litPill } from "../src/lib/learn/bookshelf-filter.ts";
import {
  contrast,
  coverStyle,
  coverTitleSize,
  mix,
  NOMINAL_LECTURE_MINUTES,
  numberOf,
  SPINE_ROOM,
  spineTitle,
  splitTitle,
  THICKNESS,
  thickness,
} from "../src/lib/learn/cover.ts";
import { MOTIFS, MOTIF_NAMES, resolveMotif } from "../src/lib/learn/motifs.ts";
import { readCover, SHELVES } from "../src/lib/learn/lecture.ts";
import { coverBox, coverSvg, DRAWN, FRAME, SW } from "../tools/learn-covers/generate.mjs";
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

test("thickness, as a fraction of the height, grows with reading time inside its limits", () => {
  assert.equal(thickness(0), THICKNESS.min);
  assert.equal(thickness(1e6), THICKNESS.max);
  assert.equal(thickness(-5), THICKNESS.min);
  let last = 0;
  for (let minutes = 0; minutes <= 900; minutes += 10) {
    const t = thickness(minutes);
    assert.ok(t >= last, `${minutes} minutes`);
    assert.ok(t >= THICKNESS.min && t <= THICKNESS.max);
    last = t;
  }
  // All of a series are close to one thickness: the thickest is under 40% wider than the thinnest.
  assert.ok(THICKNESS.max / THICKNESS.min < 1.4);
});

test("a book's place on the shelf is two digits from 01", () => {
  assert.equal(numberOf(0), "01");
  assert.equal(numberOf(8), "09");
  assert.equal(numberOf(29), "30");
  assert.equal(numberOf(99), "100");
});

test("a long title is set smaller or in two columns, never wider than the spine or longer than its room", () => {
  for (const title of ["Agents", "Agent Systems", "System Design for Working Engineers", "x".repeat(80)]) {
    for (const spine of [THICKNESS.min, 0.15, THICKNESS.max]) {
      const { size, lines } = spineTitle(title, spine);
      assert.ok(size >= 0.022 && size <= 0.04, `${title}: ${size}`);
      assert.ok(lines === 1 || lines === 2);
      if (size > 0.022) {
        assert.ok(size * 1.12 * lines <= spine - 0.05 + 0.001, `${title} @ ${spine}`);
        const perLine = Math.ceil(title.length / lines);
        assert.ok(size * perLine * 0.58 <= SPINE_ROOM + 0.001, `${title}: fits its room`);
      }
    }
  }
  assert.equal(spineTitle("Agents", 0.15).lines, 1);
  assert.equal(spineTitle("System Design for Working Engineers", 0.15).lines, 2);
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
  assert.equal(book.thickness, thickness(4 * 25));
  assert.equal(book.number, "01");
  assert.equal(book.index, 0);
  assert.equal(book.locked, false);
  assert.equal(book.cover.motif, "grid");
});

test("books are numbered across the shelves in the catalog's order", async () => {
  const books = buildShelves(await load(library())).flatMap((s) => s.books);
  assert.deepEqual(
    books.map((b) => [b.index, b.number, b.slug]),
    [
      [0, "01", "f-foundations"],
      [1, "02", "a-systems"],
      [2, "03", "b-systems"],
      [3, "04", "z-agents"],
    ],
  );
});

test("the capsule: All, then each shelf that has books, each going to the shelf's first book; the lit one follows the book in front", async () => {
  const shelves = buildShelves(await load(library()));
  const pills = filterPills(shelves);
  assert.deepEqual(
    pills.map((p) => [p.label, p.first]),
    [["All", 0], ["Foundations", 0], ["Systems", 1], ["Agents", 3]],
  );
  assert.deepEqual(
    pills.map((p) => p.key),
    ["all", "shelf:foundations", "shelf:systems", "shelf:agents"],
  );
  // No video option: the capsule goes to books, it does not hide any.
  assert.equal(pills.some((p) => /video/i.test(p.label)), false);
  const lit = [0, 1, 2, 3].map((i) => litPill(pills, i));
  assert.deepEqual(lit, ["shelf:foundations", "shelf:systems", "shelf:systems", "shelf:agents"]);
  assert.equal(litPill([{ key: "all", label: "All", first: 0 }], 5), "all");
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
          thickness(book.lectures.length * NOMINAL_LECTURE_MINUTES),
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

// ---------------------------------------------------------------------------
// Cover illustrations

test("a book of a course the reader may open carries its cover art; a locked one carries none", async () => {
  const full = await load(visibilityLibrary());
  for (const [name, readable] of Object.entries(READS)) {
    const role = name === "visitor" ? undefined : name;
    const shelves = buildShelves(forViewer(full, role, false));
    const books = shelves.flatMap((s) => s.books);
    for (const visibility of ["public", "members", "friends"] as const) {
      const book = books.find((b) => b.slug === `c-${visibility}`)!;
      if (readable.includes(visibility)) {
        assert.equal(book.locked, false, `${name}: ${visibility}`);
        assert.match(book.art, /^<svg [^>]*viewBox="0 0 240 320"/, `${name}: art of ${visibility}`);
        assert.ok(book.art.includes(`ART-c-${visibility}`), `${name}: it is this course's art`);
      } else {
        assert.equal(book.locked, true);
        assert.equal(book.art, "", `${name}: a locked book has no art`);
        // The art is not anywhere in what the shelf says about it.
        assert.equal(JSON.stringify(book).includes(`ART-c-${visibility}`), false, `${name}: no trace of the art of ${visibility}`);
        // It still has its colours and its motif, which the loader sends.
        assert.match(book.cover.color, /^#[0-9a-f]{6}$/);
        assert.ok(book.cover.motif);
      }
    }
    // No one's data holds a secret: the canaries are in bodies, never on a shelf.
    for (const v of ["public", "members", "friends", "local"] as const) {
      assert.equal(JSON.stringify(shelves).includes(SECRET[v]), false, `${name}: canary of ${v}`);
    }
  }
});

test("a course with no cover.svg has no art, and the cover falls back to its motif", async () => {
  const [book] = buildShelves(forViewer(await load(library().slice(0, 1)), undefined, false))[0]!.books;
  assert.equal(book!.art, "");
  assert.ok(MOTIF_NAMES.includes(book!.cover.motif));
});

test("a cover's drawing fills the art frame with even margins, centred", () => {
  for (const slug of DRAWN) {
    const { box, frame } = coverBox(slug, { color: "#1f3a5f", accent: "#e8b84a" })!;
    const [left, top, right, bottom] = [box[0] - frame.x, box[1] - frame.y, frame.x + frame.w - box[2], frame.y + frame.h - box[3]];
    // Inside the frame (the stroke is counted), and centred on both axes.
    for (const gap of [left, top, right, bottom]) assert.ok(gap >= -0.01, `${slug}: inside the frame (${gap})`);
    assert.ok(Math.abs(left - right) < 0.05, `${slug}: centred across`);
    assert.ok(Math.abs(top - bottom) < 0.05, `${slug}: centred down`);
    // It fills the frame on its tight axis.
    assert.ok(Math.min(left, top, right, bottom) < 0.05, `${slug}: fills the frame`);
  }
  assert.ok(FRAME.w / FRAME.h > 1.3 && FRAME.w / FRAME.h < 1.7);
});

test("every cover the generator draws passes the loader's checks, in one hand: no text, no ids, a few colours, one stroke weight", () => {
  assert.equal(DRAWN.length, 9, "one drawing per course");
  for (const slug of DRAWN) {
    for (const cover of [
      { color: "#1f3a5f", accent: "#e8b84a" },
      { color: "#2c2438", accent: "#f0a35e" },
    ]) {
      const svg = coverSvg(slug, cover)!;
      const checked = readCover(svg);
      assert.deepEqual(checked.issues, [], slug);
      assert.ok(checked.html.startsWith("<svg"), slug);
      assert.doesNotMatch(svg, /<text|<tspan|<script|<image|\sid=|\sclass=|\sdata-|href=|url\(|<style/i, slug);
      // Colours: the ink, a middle tone, a faint fill, the accent, the cover's own colour.
      const colours = new Set(svg.match(/#[0-9a-f]{6}/g));
      assert.ok(colours.size >= 3 && colours.size <= 5, `${slug}: ${colours.size} colours`);
      assert.ok(colours.has(cover.accent), `${slug}: the accent is used`);
      // One line weight on the canvas, whatever the drawing was scaled by.
      const group = /<g transform="translate\([^)]*\) scale\(([\d.]+)\)" stroke-width="([\d.]+)"/.exec(svg);
      assert.ok(group, `${slug}: one group carries the weight`);
      assert.ok(Math.abs(Number(group![1]) * Number(group![2]) - SW) < 0.01, `${slug}: stroke ${SW} on the canvas`);
      // Same text twice: the files are reproducible.
      assert.equal(coverSvg(slug, cover), svg);
    }
  }
  assert.equal(coverSvg("not-a-course", { color: "#000000", accent: "#ffffff" }), undefined);
});

test("the turn's curve has a point for every hundredth of the move, and the shade turns with the book", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/styles/learn-bookshelf.css", import.meta.url), "utf8");
  const points = /--spring:\s*linear\(([^)]*)\)/.exec(css)?.[1]?.split(",") ?? [];
  assert.ok(points.length >= 100, `the spring has ${points.length} points; at 240 Hz fewer shows as steps`);
  const values = points.map((p) => Number.parseFloat(p));
  assert.ok(values.every((v, i) => i === 0 || v >= values[i - 1]!), "it never goes back");
  assert.equal(values.at(-1), 1);
  // The shade's opacity has the move's own time and curve: it never snaps.
  assert.match(css, /\.tb \.cover::after\s*\{\s*transition:\s*opacity var\(--duration\) var\(--spring\);/);
});

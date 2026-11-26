import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findCourse,
  forViewer,
  loadCatalog,
  type CourseSource,
} from "../src/lib/learn/catalog.ts";
import { buildLecture, LectureError, type SourceFile } from "../src/lib/learn/lecture.ts";
import { splitSectionsV2 } from "../src/lib/learn/blocks.ts";
import {
  DIAGRAMS,
  FRONT,
  QUESTION,
  SVG,
  lectureV2,
  sections,
  withBody,
  without,
  words,
  type Section,
} from "./helpers/lecture-v2.ts";

const PUBLIC = { shows: () => true };

const build = (file: SourceFile, diagrams: ReadonlyMap<string, string> = DIAGRAMS) =>
  buildLecture(file, "c", diagrams, new Set(), PUBLIC);

/** The one error text a bad lecture gives, or "" when it builds. */
async function issuesOf(
  file: SourceFile,
  diagrams: ReadonlyMap<string, string> = DIAGRAMS,
): Promise<string> {
  try {
    await build(file, diagrams);
  } catch (error) {
    assert.ok(error instanceof LectureError, String(error));
    return error.issues.join("\n");
  }
  return "";
}

test("a complete version 2 lecture builds as one page, in reading order", async () => {
  const built = await build(lectureV2());
  assert.equal(built.front.format, 2);
  assert.equal(built.front.minutes, 28);
  assert.deepEqual(
    built.toc.map((h) => h.text),
    [
      "In brief",
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Section ${n}`),
      "Worked example",
      "Limits and open questions",
      "In practice",
      "Explain it back",
      "Interview questions",
      "Check yourself",
      "References",
    ],
  );
  assert.deepEqual(
    built.toc.filter((h) => h.number !== undefined).map((h) => h.shown),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  // Order on the page is the order of the file, and the list of sources ends it.
  const at = (needle: string): number => built.html.indexOf(needle);
  assert.ok(at('id="in-brief"') >= 0);
  assert.ok(at('id="in-brief"') < at('id="section-1"'));
  assert.ok(at('id="section-8"') < at('id="worked-example"'));
  assert.ok(at('id="check-yourself"') < at('id="references"'));
  assert.ok(at('id="references"') < at('class="references"'));
  assert.equal(built.html.match(/<figure class="diagram"/g)?.length, 4);
  assert.equal(built.html.match(/<details class="question"/g)?.length, 3 + 4 + 5);
  assert.doesNotMatch(built.html, /data-layer|layer-tag|Waterline|Abyss/);
  assert.equal(built.words.length, 16);
  assert.equal(built.words[0]!.title, "In brief");
  assert.equal(built.words[0]!.words, 200);
  assert.match(built.text, /word/);
  assert.deepEqual(built.warnings, []);
});

test("the sections of a version 2 lecture split at ## and never at #", () => {
  const list = splitSectionsV2("## A\n\ntext\n\n```\n## not a heading\n# nor this\n```\n## B\n", 10);
  assert.deepEqual(
    list.map((s) => [s.title, s.line]),
    [
      ["A", 10],
      ["B", 18],
    ],
  );
  assert.match(list[0]!.text, /not a heading/);
  assert.throws(() => splitSectionsV2("## A\n\n# Tip\n", 1), /no "#" headings/);
  assert.throws(() => splitSectionsV2("text first\n\n## A\n", 1), /text before "## In brief"/);
});

const missing = [
  "Worked example",
  "Limits and open questions",
  "In practice",
  "Explain it back",
  "Interview questions",
  "Check yourself",
  "References",
];

for (const name of missing) {
  test(`error: a lecture without "${name}"`, async () => {
    const issues = await issuesOf(
      lectureV2(
        (list) =>
          name === "Worked example"
            ? list.filter(([h]) => h !== name)
            : without(name)(list),
      ),
    );
    assert.match(issues, new RegExp(`missing the "## ${name}`));
  });
}

test("error: no In brief", async () => {
  assert.match(await issuesOf(lectureV2(without("In brief"))), /missing the "## In brief"/);
});

test("error: sections out of order", async () => {
  const swap = (list: Section[]): Section[] => {
    const copy = [...list];
    const a = copy.findIndex(([h]) => h === "Limits and open questions");
    const b = copy.findIndex(([h]) => h === "In practice");
    [copy[a], copy[b]] = [copy[b]!, copy[a]!];
    return copy;
  };
  assert.match(await issuesOf(lectureV2(swap)), /the sections come in this order/);
});

test("a Worked example may stand between numbered sections", async () => {
  const between = (list: Section[]): Section[] => {
    const at = list.findIndex(([h]) => h.startsWith("4."));
    return [...list.slice(0, at + 1), ["Worked example", words(100)], ...list.slice(at + 1)];
  };
  await build(lectureV2(between));
});

test("error: a section that is neither numbered nor one of the frame sections", async () => {
  const extra = (list: Section[]): Section[] => [
    ...list.slice(0, 3),
    ["Notes", words(10)],
    ...list.slice(3),
  ];
  assert.match(await issuesOf(lectureV2(extra)), /"## Notes" is not one of the sections/);
});

test("error: numbered sections out of count and out of order", async () => {
  const numbered = (n: number) => (list: Section[]): Section[] => [
    ...list.filter(([h]) => !/^\d+\./.test(h)).slice(0, 1),
    ...Array.from({ length: n }, (_, i): Section => [
      `${i + 1}. S${i + 1}`,
      `${words(3500 / n)}${i < 4 ? `\n\n![[diagram: 0${i + 1}-${["one", "two", "three", "four"][i]} | **Fig.** A caption.]]` : ""}`,
    ]),
    ...list.filter(([h]) => !/^\d+\./.test(h)).slice(1),
  ];
  assert.match(await issuesOf(lectureV2(numbered(5))), /5 numbered sections; a lecture has 6 to 14/);
  assert.match(await issuesOf(lectureV2(numbered(15))), /15 numbered sections; a lecture has 6 to 14/);
  await build(lectureV2(numbered(6)));
  await build(lectureV2(numbered(14)));

  const skipped = (list: Section[]): Section[] =>
    list.map(([h, t]): Section => (h === "3. Section 3" ? ["4. Section 3", t] : [h, t]));
  assert.match(await issuesOf(lectureV2(skipped)), /count 1, 2, 3/);
});

test("error: word ranges", async () => {
  assert.match(
    await issuesOf(lectureV2(withBody("In brief", words(100)))),
    /In brief has 100 words; the contract asks for 150 to 350/,
  );
  assert.match(
    await issuesOf(lectureV2(withBody("In brief", words(400)))),
    /In brief has 400 words; the contract asks for 150 to 350/,
  );
  assert.match(
    await issuesOf(lectureV2(withBody("Limits and open questions", words(100)))),
    /Limits and open questions has 100 words; the contract asks for 200 to 900/,
  );
  assert.match(
    await issuesOf(lectureV2(withBody("Limits and open questions", words(950)))),
    /Limits and open questions has 950 words/,
  );
  assert.match(
    await issuesOf(lectureV2(withBody("In practice", words(100)))),
    /In practice has 100 words; the contract asks for 200 to 700/,
  );
  assert.match(
    await issuesOf(lectureV2(withBody("In practice", words(750)))),
    /In practice has 750 words/,
  );
  const thin = (list: Section[]): Section[] =>
    list.map(([h, t]): Section => (/^\d+\./.test(h) ? [h, words(60)] : [h, t]));
  assert.match(await issuesOf(lectureV2(thin)), /The lecture has \d+ words; the contract asks for 3000 to 9000/);
  const fat = (list: Section[]): Section[] =>
    list.map(([h, t]): Section => (/^\d+\./.test(h) ? [h, `${words(600)}\n\n${t}`] : [h, t]));
  assert.match(await issuesOf(lectureV2(fat)), /The lecture has \d+ words; the contract asks for 3000 to 9000/);
});

test("error: the number of questions of each kind", async () => {
  const questions = (heading: string, n: number) =>
    withBody(heading, Array(n).fill(QUESTION).join("\n\n"));
  assert.match(await issuesOf(lectureV2(questions("Check yourself", 4))), /Check yourself has 4; the contract asks for exactly 5/);
  assert.match(await issuesOf(lectureV2(questions("Check yourself", 6))), /Check yourself has 6/);
  assert.match(await issuesOf(lectureV2(questions("Explain it back", 2))), /Explain it back has 2; the contract asks for 3 to 5/);
  assert.match(await issuesOf(lectureV2(questions("Explain it back", 6))), /Explain it back has 6/);
  assert.match(await issuesOf(lectureV2(questions("Interview questions", 3))), /Interview questions has 3; the contract asks for 4 to 8/);
  assert.match(await issuesOf(lectureV2(questions("Interview questions", 9))), /Interview questions has 9/);
});

test("error: fewer than four diagrams", async () => {
  const fewer = (list: Section[]): Section[] =>
    list.map(([h, t]): Section => [h, t.replace(/\n\n!\[\[diagram: 04-four[^\n]*/, "")]);
  assert.match(await issuesOf(lectureV2(fewer)), /3 diagrams; a lecture has at least 4/);
});

test("error: a diagram with a literal colour, or no file", async () => {
  const red = new Map(DIAGRAMS).set("01-one", SVG.replace("var(--c1)", "#ff0000"));
  assert.match(await issuesOf(lectureV2(), red), /diagram 01-one: fill:#ff0000 is not allowed/);
  const gone = new Map(DIAGRAMS);
  gone.delete("02-two");
  assert.match(await issuesOf(lectureV2(), gone), /diagram 02-two has no file/);
});

test("error: prose swallowed into a formula", async () => {
  const money = withBody("1. Section 1", `${words(450)} It costs $2.50 for the first thing and then $3.00 for the other thing.`);
  assert.match(await issuesOf(lectureV2(money)), /inline maths holds ordinary words/);
});

test("error: a # heading, and text before the first section", async () => {
  const hash = withBody("1. Section 1", `# A title\n\n${words(450)}`);
  assert.match(await issuesOf(lectureV2(hash)), /no "#" headings/);
  const before = lectureV2();
  before.raw = before.raw.replace("## In brief", "Stray text.\n\n## In brief");
  assert.match(await issuesOf(before), /text before "## In brief"/);
});

test("error: an unknown source id", async () => {
  assert.match(
    await issuesOf(lectureV2(withBody("1. Section 1", `${words(450)} See [Nowhere].`))),
    /\[Nowhere\] is not a source id/,
  );
});

test("front matter: minutes is one integer and format is 2", async () => {
  const object = FRONT.replace("minutes: 28", "minutes: { tip: 2, waterline: 9, deep: 8, abyss: 6 }");
  assert.match(await issuesOf(lectureV2(undefined, object)), /"minutes" must be a whole number/);
  assert.match(
    await issuesOf(lectureV2(undefined, FRONT.replace("format: 2", "format: 3"))),
    /"format" is 2/,
  );
  // A version 1 front matter with one number is not accepted either.
  assert.match(
    await issuesOf(lectureV2(undefined, FRONT.replace("format: 2\n", ""))),
    /"minutes" lists tip, waterline, deep and abyss/,
  );
});

test("a placeholder keeps the structure but not the counts", async () => {
  const small = (list: Section[]): Section[] =>
    list.map(([h, t]): Section => (h === "Explain it back" ? [h, QUESTION] : [h, t]));
  const front = FRONT.replace("minutes: 28", "minutes: 28\nplaceholder: true");
  const tiny = lectureV2(
    (list) =>
      small(list).map(([h, t]): Section => (/^\d+\./.test(h) || h === "In brief" ? [h, words(5)] : [h, t])),
    front,
  );
  // Too few words and too few diagrams are fine in a placeholder; a missing section is not.
  const built = await build(tiny);
  assert.equal(built.front.placeholder, true);
  assert.match(await issuesOf(lectureV2(without("In practice"), front)), /missing the "## In practice"/);
});

test("version 2 warnings do not fail the build", async () => {
  const brief = withBody("In brief", `${words(200)}\n\n$$x$$`);
  const built = await build(lectureV2(brief));
  assert.deepEqual(built.warnings, ["In brief has no formulas and no code"]);
  const weak = withBody(
    "Explain it back",
    [1, 2, 3].map(() => "<details><summary>Explain.</summary>Just words.</details>").join("\n\n"),
  );
  const second = await build(lectureV2(weak));
  assert.equal(second.warnings.length, 3);
  assert.match(second.warnings[0]!, /A good explanation covers/);
});

test("a version 2 lecture a reader may not open is never rendered", async () => {
  const locked = await buildLecture(lectureV2(), "c", DIAGRAMS, new Set(), { shows: () => false });
  assert.equal(locked.locked, true);
  assert.equal(locked.html, "");
  assert.deepEqual(locked.toc, []);
  assert.deepEqual(locked.words, []);
});

test("the sections() fixture is the contract's list", () => {
  assert.deepEqual(
    sections().map(([h]) => h.replace(/^\d+\. .*/, "N")),
    [
      "In brief",
      ...Array(8).fill("N"),
      "Worked example",
      "Limits and open questions",
      "In practice",
      "Explain it back",
      "Interview questions",
      "Check yourself",
      "References",
    ],
  );
});

// ---------------------------------------------------------------------------
// cover.svg

const COVER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320"><rect width="240" height="320" fill="#1f3a5f"/><circle cx="120" cy="160" r="40" fill="#e8b84a"/></svg>`;

function courseSource(visibility: string, cover?: string): CourseSource {
  return {
    slug: "c",
    dir: "/somewhere/c",
    course: {
      path: "c/course.md",
      name: "course.md",
      raw: `---\nslug: c\ntitle: C\nshelf: systems\npromise: A course.\nvisibility: ${visibility}\norder: 1\ncover: { color: "#3a3f4b", accent: "#9aa3b5", motif: "grid" }\n---\n\nIntro.\n`,
    },
    lectures: [lectureV2()],
    diagrams: DIAGRAMS,
    media: new Set(),
    ...(cover === undefined ? {} : { cover }),
  };
}

test("a course's cover.svg reaches the catalog sanitised, and a locked course does not carry it", async () => {
  const none = await loadCatalog({ courses: [courseSource("public")] }, { allowLocal: false });
  assert.equal(findCourse(none, "c")!.coverSvg, "");

  const catalog = await loadCatalog(
    { courses: [courseSource("members", COVER)] },
    { allowLocal: false },
  );
  const full = findCourse(catalog, "c")!;
  assert.match(full.coverSvg, /^<svg [^>]*viewBox="0 0 240 320"/);
  assert.match(full.coverSvg, /fill="#1f3a5f"/);
  // A visitor sees the course locked: title, promise, shelf and cover colours, and no cover art.
  const visitor = findCourse(forViewer(catalog, undefined, false), "c")!;
  assert.equal(visitor.locked, true);
  assert.equal(visitor.coverSvg, "");
  assert.equal(JSON.stringify(visitor).includes("1f3a5f\"/><circle"), false);
  const member = findCourse(forViewer(catalog, "member", false), "c")!;
  assert.equal(member.locked, false);
  assert.equal(member.coverSvg, full.coverSvg);
});

test("a bad cover.svg is an error strictly and a left-out course leniently", async () => {
  for (const [cover, why] of [
    [COVER.replace("0 0 240 320", "0 0 10 10"), /viewBox="0 0 240 320"/],
    [COVER.replace("<rect", "<text>hi</text><rect"), /no text/],
    [COVER.replace("<rect", "<script>x()</script><rect"), /<script> is not allowed/],
    [COVER.replace("<rect", '<image href="https://example.com/x.png"/><rect'), /<image> is not allowed/],
    [COVER.replace("<circle", '<circle onclick="x()"'), /event handler onclick/],
  ] as const) {
    const content = { courses: [courseSource("public", cover)] };
    await assert.rejects(loadCatalog(content, { allowLocal: false }), why);
    const lenient = await loadCatalog(content, { allowLocal: false, lenient: true });
    assert.equal(lenient.courses.length, 0);
    assert.equal(lenient.problemCount, 1);
  }
});

test("the outline reads a heading's formulas, and the anchor's id is still made from its prose", async () => {
  const built = await build(
    lectureV2((list) =>
      list.map(([h, body]) =>
        h === "3. Section 3"
          ? ["3. Why the hidden size is $d_{\\text{model}}$, and why not $\\frac{8}{3}d$", body]
          : [h, body],
      ),
    ),
  );
  const heading = built.toc.find((h) => h.number === 3)!;
  assert.equal(heading.text, "Why the hidden size is d_model, and why not 8/3d");
  // The id is what it was when formulas were left out, so links written against it keep working.
  assert.equal(heading.id, "why-the-hidden-size-is--and-why-not");
  assert.ok(built.html.includes('id="why-the-hidden-size-is--and-why-not"'));
});

test("a formula KaTeX cannot read, and a malformed diagram line, are errors of the file with their line, never a crash", async () => {
  const formula = await issuesOf(lectureV2(withBody("1. Section 1", `${words(450)} A bad formula $\\badcommand{x}$ here.`)));
  assert.match(formula, /line \d+: the formula "\\badcommand\{x\}" does not parse: Undefined control sequence: \\badcommand/);
  assert.doesNotMatch(formula, /position|KaTeX parse error/);
  for (const line of ["![[diagram: 01-one | caption without a close", "![[diagram: ]]"]) {
    const found = await issuesOf(lectureV2(withBody("1. Section 1", `${words(450)}\n\n${line}`)));
    assert.match(found, /line \d+: a diagram line is !\[\[diagram: NN-name \| Caption\.\]\]/);
  }
});

test("figures on one page do not share ids: each label names its own figure's title, and its markers are its own", async () => {
  const svg = (n: string): string =>
    `<svg viewBox="0 0 10 10" role="img" aria-labelledby="t d"><title id="t">Title ${n}</title><desc id="d">Desc ${n}</desc><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4z" fill="var(--c1)"/></marker><linearGradient id="g"><stop offset="0" stop-color="var(--c1)"/></linearGradient></defs><line x1="0" y1="0" x2="9" y2="9" stroke="var(--border)" marker-end="url(#ah)"/><rect width="5" height="5" fill="url(#g)"/><use href="#ah"/></svg>`;
  const built = await build(lectureV2(), new Map([["01-one", svg("1")], ["02-two", svg("2")], ["03-three", svg("3")], ["04-four", svg("4")]]));
  const ids = [...built.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set(ids).size, ids.length, "no id is on the page twice");
  for (const [stem, n] of [["01-one", "1"], ["02-two", "2"]] as const) {
    const figure = new RegExp(`<figure[^>]*data-diagram="${stem}"[\\s\\S]*?</figure>`).exec(built.html)![0];
    assert.match(figure, new RegExp(`aria-labelledby="fig-${stem}-t fig-${stem}-d"`));
    assert.match(figure, new RegExp(`<title id="fig-${stem}-t">Title ${n}`));
    assert.match(figure, new RegExp(`marker-end="url\\(#fig-${stem}-ah\\)"`));
    assert.match(figure, new RegExp(`fill="url\\(#fig-${stem}-g\\)"`));
    assert.match(figure, new RegExp(`href="#fig-${stem}-ah"`));
    // Nothing still points at a bare id.
    assert.doesNotMatch(figure, /url\(#(?:ah|g)\)|href="#ah"|labelledby="t d"/);
  }
});

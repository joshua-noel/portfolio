import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  findCourse,
  findLecture,
  loadCatalog,
  neighbours,
  type Content,
  type CourseSource,
} from "../src/lib/learn/catalog.ts";
import { readContentDir } from "../src/lib/learn/disk.ts";
import {
  buildLecture,
  checkDiagram,
  type BuildOptions,
  LectureError,
  proseWords,
  type SourceFile,
} from "../src/lib/learn/lecture.ts";
import { Renderer, smarten, type HNode } from "../src/lib/learn/render.ts";
import { search } from "../src/lib/learn/search.ts";

const SVG = `<svg viewBox="0 0 10 10"><title>x</title><desc>y</desc><rect width="5" height="5" fill="var(--c1)" stroke="var(--border)" /></svg>`;
const DIAGRAMS = new Map([
  ["01-one", SVG],
  ["02-two", SVG],
]);
const PUBLIC: BuildOptions = { shows: () => true, wordsAreErrors: true };

const words = (n: number): string => Array.from({ length: n }, () => "word").join(" ");

const QUESTION = "<details><summary>A question?</summary>An answer.</details>";

interface Options {
  /** A ready lecture, with the word counts the contract asks for. */
  ready?: boolean;
  /** Replace a piece of the lecture, by name. */
  edit?: Partial<
    Record<"front" | "tip" | "waterline" | "deep" | "abyss" | "check", string>
  >;
}

/** A complete, valid lecture. Placeholders skip the word counts; ready ones meet them. */
function lecture({ ready = false, edit = {} }: Options = {}): SourceFile {
  const w = (placeholder: number, full: number): string =>
    words(ready ? full : placeholder);
  const front =
    edit.front ??
    `---
course: c
order: 1
slug: a-lecture
title: A lecture
promise: What it promises.
visibility: public
video: false
${ready ? "" : "placeholder: true\n"}minutes: { tip: 2, waterline: 9, deep: 8, abyss: 6 }
objectives:
  - One.
  - Two.
  - Three.
prerequisites: []
sources:
  - { id: Paper, title: "A paper", url: "https://example.com/paper", used_for: "everything" }
checked: 2026-11-01
---
`;
  const waterline =
    edit.waterline ??
    `## The idea in one paragraph

One paragraph, with $x^2$ and a citation [Paper]. ${w(0, 100)}

${[1, 2, 3, 4].map((n) => `## ${n}. Section ${n}\n\n${w(5, 330)}\n`).join("\n")}
![[diagram: 01-one | **One.** A caption.]]

![[diagram: 02-two | **Two.** Another.]]

## Worked example

${w(5, 100)}`;
  const check =
    edit.check ??
    `## Check yourself\n\n${Array(5).fill(QUESTION).join("\n\n")}\n\n## References\n`;
  return {
    path: "01-a-lecture.md",
    name: "01-a-lecture.md",
    raw: `${front}
# Tip

${edit.tip ?? w(10, 300)}

# Waterline

${waterline}

${check}

# Deep

${edit.deep ?? `## 1. Deeper\n\n${w(5, 1300)}\n\n![[diagram: 01-one | **Again.** In Deep.]]`}

# Abyss

${edit.abyss ?? `## 1. Deepest\n\n${w(5, 1100)}`}
`,
  };
}

const issuesOf = async (
  file: SourceFile,
  options: BuildOptions = PUBLIC,
): Promise<string> => {
  try {
    await buildLecture(file, "c", DIAGRAMS, new Set(), options);
  } catch (error) {
    assert.ok(error instanceof LectureError, String(error));
    return error.issues.join("\n");
  }
  return "";
};

test("a complete version 1 lecture builds as one page: the old depths read in order, Check yourself last", async () => {
  const built = await buildLecture(
    lecture({ ready: true }),
    "c",
    DIAGRAMS,
    new Set(),
    PUBLIC,
  );
  assert.equal(built.front.format, 1);
  // One reading time: the four old layers added up.
  assert.equal(built.front.minutes, 25);
  assert.ok(built.html.startsWith('<h2 id="in-brief" class="frame frame-brief">In brief'));
  assert.match(built.html, /Check yourself[\s\S]*<ol class="references">/);
  assert.deepEqual(
    built.toc.filter((h) => h.depth === 2).map((h) => [h.shown, h.text]),
    [
      [undefined, "In brief"],
      [undefined, "The idea in one paragraph"],
      [1, "Section 1"],
      [2, "Section 2"],
      [3, "Section 3"],
      [4, "Section 4"],
      [undefined, "Worked example"],
      // The numbers run on from Waterline into Deep and Abyss: no two sections are "1".
      [5, "Deeper"],
      [6, "Deepest"],
      [undefined, "Check yourself"],
      [undefined, "References"],
    ],
  );
  const at = (needle: string): number => built.html.indexOf(needle);
  assert.ok(at('id="in-brief"') < at('id="the-idea-in-one-paragraph"'));
  assert.ok(at('id="worked-example"') < at('id="deeper"'));
  assert.ok(at('id="deeper"') < at('id="deepest"'));
  assert.ok(at('id="deepest"') < at('id="check-yourself"'));
  // The old names are not shown anywhere, and nothing marks a layer.
  assert.doesNotMatch(built.html, /data-layer|layer-tag|>Tip<|>Waterline<|>Deep<|>Abyss</);
  assert.deepEqual(built.words, []);
});

test("a version 1 lecture's old rules still apply", async () => {
  assert.match(
    await issuesOf(lecture({ edit: { tip: "A formula $x$ in the Tip." } })),
    /Tip has no formulas and no code/,
  );
  const mixed = lecture();
  mixed.raw = mixed.raw.replace("minutes: { tip: 2, waterline: 9, deep: 8, abyss: 6 }", "minutes: 25");
  assert.match(await issuesOf(mixed), /"minutes" lists tip, waterline, deep and abyss/);
});

test("maths and citations render on the server; answers stay closed", async () => {
  const { html, objectivesHtml } = await buildLecture(
    lecture(),
    "c",
    DIAGRAMS,
    new Set(),
    PUBLIC,
  );
  assert.match(html, /class="katex"/);
  assert.match(html, /<a class="cite" href="#ref-Paper">\[Paper\]<\/a>/);
  assert.match(
    html,
    /<li id="ref-Paper"><a href="https:\/\/example.com\/paper">A paper<\/a>/,
  );
  assert.match(html, /<details class="question"><summary>/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.equal(objectivesHtml.length, 3);
});

test("a diagram is inlined, sized by its viewBox, with an accessible name", async () => {
  const { html } = await buildLecture(lecture(), "c", DIAGRAMS, new Set(), PUBLIC);
  assert.match(html, /<figure class="diagram" data-diagram="01-one" style="--w:10">/);
  assert.match(html, /<svg role="img" aria-label="x" viewBox="0 0 10 10">/);
  assert.match(html, /<figcaption><strong>One\.<\/strong> A caption\.<\/figcaption>/);
});

test("the contract's word ranges are enforced for a ready lecture only", async () => {
  assert.equal(await issuesOf(lecture({ ready: true })), "");
  assert.equal(await issuesOf(lecture()), "");
  assert.match(
    await issuesOf(lecture({ ready: true, edit: { tip: words(100) } })),
    /Tip has 100 words; the contract asks for 250 to 350/,
  );
  assert.match(
    await issuesOf(
      lecture({ ready: true, edit: { deep: `## 1. Deeper\n\n${words(2500)}` } }),
    ),
    /Deep has 25\d\d words/,
  );
});

test("missing sections are named", async () => {
  const noDeep = lecture();
  noDeep.raw = noDeep.raw.replace(/# Deep[\s\S]*# Abyss/, "# Abyss");
  assert.match(await issuesOf(noDeep), /missing the "# Deep"/);
});

test("Waterline has its idea, 4 to 7 numbered sections, a worked example, five questions, references", async () => {
  const ready = (waterline: string, check?: string) =>
    lecture({ ready: true, edit: { waterline, ...(check ? { check } : {}) } });
  assert.match(
    await issuesOf(ready("## 1. Only\n\ntext\n")),
    /missing the "## The idea in one paragraph"/,
  );
  assert.match(
    await issuesOf(lecture({ edit: { check: `## Check yourself\n\n${QUESTION}\n` } })),
    /missing the "## References"/,
  );
  assert.match(
    await issuesOf(
      lecture({
        ready: true,
        edit: { check: `## Check yourself\n\n${QUESTION}\n\n## References\n` },
      }),
    ),
    /1 questions; it has exactly 5/,
  );
  const unnumbered = lecture().raw.replace("## 2. Section 2", "## Section 2");
  assert.match(await issuesOf({ ...lecture(), raw: unnumbered }), /must be numbered/);
  const gap = lecture().raw.replace("## 3. Section 3", "## 4. Section 3");
  assert.match(await issuesOf({ ...lecture(), raw: gap }), /count 1, 2, 3/);
  const fewer = lecture({ ready: true }).raw.replace(
    /## 4\. Section 4[\s\S]*?(?=!\[\[)/,
    "",
  );
  assert.match(
    await issuesOf({ ...lecture(), raw: fewer }),
    /3 numbered sections; a lecture has 4 to 7/,
  );
  const order = lecture().raw.replace(
    "## Worked example",
    "## Worked example\n\nx\n\n## 5. Late",
  );
  assert.match(await issuesOf({ ...lecture(), raw: order }), /come in this order/);
  const twoParagraphs = lecture().raw.replace(
    "## 1. Section 1",
    "A second paragraph.\n\n## 1. Section 1",
  );
  assert.match(
    await issuesOf({ ...lecture(), raw: twoParagraphs }),
    /idea in one paragraph" has 2 paragraphs/,
  );
  assert.match(
    await issuesOf(
      lecture({
        ready: true,
        edit: {
          waterline: lecture({ ready: true })
            .raw.match(/## The idea[\s\S]*?(?=## Check)/)![0]
            .replace(/!\[\[diagram: 02-two[^\n]*\n/, ""),
        },
      }),
    ),
    /1 diagrams; it has at least two/,
  );
});

test("Deep sections are numbered from 1, and Tip has no formulas", async () => {
  assert.match(
    await issuesOf(lecture({ edit: { deep: "## Deeper\n\ntext" } })),
    /Deep: "## Deeper" must be numbered/,
  );
  assert.match(
    await issuesOf(lecture({ edit: { deep: "text only" } })),
    /Deep: needs at least one/,
  );
  assert.match(
    await issuesOf(lecture({ edit: { tip: "The formula $x$." } })),
    /Tip has no formulas/,
  );
  assert.match(
    await issuesOf(lecture({ edit: { tip: "Intro.\n\n# Oops\n" } })),
    /only "#" sections/,
  );
});

test("citations must be source ids", async () => {
  const unknown = lecture().raw.replace("[Paper]", "[Missing]");
  assert.match(
    await issuesOf({ ...lecture(), raw: unknown }),
    /\[Missing\] is not a source id/,
  );
  const brackets = lecture().raw.replace("[Paper]", "[0, 1] and [a]");
  assert.equal(await issuesOf({ ...lecture(), raw: brackets }), "");
});

test("callouts are recognised", async () => {
  const html = await new Renderer().render(
    "> **Note.** Careful.\n\n> **Common mistake.** Wrong.\n\n> Plain quote.",
    "waterline",
  );
  assert.match(html, /<blockquote class="callout callout-note">/);
  assert.match(html, /<blockquote class="callout callout-mistake">/);
  assert.match(html, /<blockquote>\n<p>Plain quote/);
});

test("front matter is checked against the contract", async () => {
  const front = (change: (s: string) => string): SourceFile => {
    const base = lecture();
    return { ...base, raw: change(base.raw) };
  };
  assert.match(
    await issuesOf(front((s) => s.replace("course: c", "course: other"))),
    /"course" is "other"/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("order: 1", "order: 2"))),
    /file name says 01/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("slug: a-lecture", "slug: another"))),
    /file name says "a-lecture"/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("visibility: public", "visibility: secret"))),
    /one of public, members, friends, local/,
  );
  const ready = lecture({ ready: true });
  assert.match(
    await issuesOf({ ...ready, raw: ready.raw.replace("  - Three.\n", "") }),
    /2 objectives; a lecture has 3 to 5/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("checked: 2026-11-01", "checked: 2999-01-01"))),
    /in the future/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("checked: 2026-11-01", "checked: yesterday"))),
    /YYYY-MM-DD/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("https://example.com/paper", "ftp://x"))),
    /web address/,
  );
  assert.match(
    await issuesOf(front((s) => s.replace("{ tip: 2,", "{ tip: 0,"))),
    /"tip" must be a whole number/,
  );
  assert.match(
    await issuesOf({ ...lecture(), name: "lecture.md" }),
    /NN-lecture-slug\.md/,
  );
});

test("diagrams follow the theme and the contract", () => {
  assert.deepEqual(checkDiagram("01-one", SVG), []);
  const bad = (svg: string): string => checkDiagram("01-one", svg).join("\n");
  assert.match(
    bad(SVG.replace('fill="var(--c1)"', 'fill="#ff0000"')),
    /#ff0000 is not allowed/,
  );
  assert.match(bad(SVG.replace('fill="var(--c1)"', 'fill="red"')), /red is not allowed/);
  assert.match(
    bad(SVG.replace('fill="var(--c1)"', 'style="fill:var(--c7)"')),
    /var\(--c7\) is not allowed/,
  );
  assert.equal(bad(SVG.replace('fill="var(--c1)"', 'fill="currentColor"')), "");
  assert.match(bad(SVG.replace("<svg ", '<svg width="100" ')), /no width or height/);
  assert.match(bad(SVG.replace(' viewBox="0 0 10 10"', "")), /needs a viewBox/);
  assert.match(bad(SVG.replace("<desc>y</desc>", "")), /needs a <desc>/);
  assert.match(
    bad(SVG.replace("</svg>", '<image href="a.png" /></svg>')),
    /embedded images/,
  );
  assert.match(bad(SVG.replace("</svg>", "<script>1</script></svg>")), /no <script>/);
  assert.match(
    bad(SVG.replace("</svg>", '<a href="https://x.test"/></svg>')),
    /no external links/,
  );
});

test("words are prose: no code, maths or diagram lines", () => {
  assert.equal(
    proseWords(
      "One two $x + y$ three.\n\n```py\nnot counted here\n```\n$$\na = b\n$$\n$$c$$\n![[diagram: 01-a | caption]]\nfour",
    ),
    4,
  );
  assert.equal(proseWords("A [link](https://example.com/some/path) and <b>bold</b>."), 4);
});

test("a lecture this process may not show is checked but not rendered", async () => {
  const members = lecture();
  members.raw = members.raw.replace("visibility: public", "visibility: members");
  const built = await buildLecture(members, "c", DIAGRAMS, new Set(), {
    shows: (v) => v === "public",
  });
  assert.equal(built.locked, true);
  assert.equal(built.html, "");
  assert.equal(built.text, "");
  assert.equal(built.front.visibility, "members");
  // Still checked: a locked lecture with a broken front matter fails too.
  members.raw = members.raw.replace("order: 1", "order: 7");
  assert.match(
    await issuesOf(members, { shows: (v) => v === "public" }),
    /file name says 01/,
  );
});

test("video files are found beside the lecture, and a missing one is a warning", async () => {
  const withVideo = lecture();
  withVideo.raw = withVideo.raw.replace("video: false", "video: true");
  const none = await buildLecture(withVideo, "c", DIAGRAMS, new Set(), PUBLIC);
  assert.match(
    none.warnings.join(),
    /01-a-lecture\.mp4 and 01-a-lecture\.vtt are not both there yet/,
  );
  const files = new Set([
    "01-a-lecture.mp4",
    "01-a-lecture.vtt",
    "01-a-lecture.poster.png",
  ]);
  const found = await buildLecture(withVideo, "c", DIAGRAMS, files, PUBLIC);
  assert.deepEqual(found.media, {
    video: true,
    captions: true,
    poster: "01-a-lecture.poster.png",
  });
  assert.deepEqual(found.warnings, []);
});


test("quotes curl in prose and nowhere else", () => {
  const text = (value: string): HNode => ({ type: "text", value });
  const tree: HNode = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        children: [
          text('He said "hi" and it\'s fine, "'),
          { type: "element", tagName: "strong", children: [text("cat")] },
          text('" ends.'),
        ],
      },
      { type: "element", tagName: "code", children: [text('print("x")')] },
    ],
  };
  smarten(tree);
  const paragraph = tree.children![0]!.children!;
  assert.equal(paragraph[0]!.value, "He said \u201chi\u201d and it\u2019s fine, \u201c");
  assert.equal(paragraph[2]!.value, "\u201d ends.");
  assert.equal(tree.children![1]!.children![0]!.value, 'print("x")');
});

test("punctuation stays with the formula it touches", async () => {
  const html = await new Renderer().render(
    "So ($x^2$), and $y$. Then $z$ again.",
    "waterline",
  );
  assert.match(html, /<span class="nobr">\(<span class="katex">.*?<\/span>\),<\/span>/s);
  assert.match(
    html,
    /<span class="nobr"><span class="katex">.*?<\/span>\.<\/span> Then/s,
  );
  assert.match(html, /<span class="katex">.*?<\/span> again\./s);
});

// ---------------------------------------------------------------------------
// The catalog

const sample = fileURLToPath(new URL("../content/learn", import.meta.url));

const course = (slug: string, extra = "", lectures: SourceFile[] = []): CourseSource => ({
  slug,
  dir: `/fixture/${slug}`,
  course: {
    path: `${slug}/course.md`,
    name: "course.md",
    raw: `---\nslug: ${slug}\ntitle: Course ${slug}\nshelf: systems\npromise: P.\nvisibility: public\norder: 1\ncover: { color: "#112233", accent: "#445566", motif: "grid" }\n${extra}---\nIntro with $x$.\n`,
  },
  lectures,
  diagrams: DIAGRAMS,
  media: new Set(),
});

test("the lectures in the repository pass the contract and are public", async () => {
  const catalog = await loadCatalog(readContentDir(sample), {
    allowLocal: true,
    repository: true,
  });
  assert.ok(catalog.lectures.length >= 2);
  assert.ok(catalog.shelves.length >= 2);
});

test("shelves stand in their order, courses and lectures by their order, with neighbours", async () => {
  const catalog = await loadCatalog(readContentDir(sample), { allowLocal: false });
  assert.deepEqual(
    catalog.shelves.map((s) => s.id),
    ["systems", "language-models"],
  );
  const models = findCourse(catalog, "how-language-models-work")!;
  const first = findLecture(models, "attention-and-the-transformer")!;
  assert.equal(first.front.order, 1);
  assert.equal(neighbours(models, first.slug).previous, undefined);
  assert.equal(neighbours(models, first.slug).next, undefined);
  assert.match(models.introHtml, /<p>/);
});

test("courses and lectures must agree", async () => {
  const bad = course("c");
  bad.course.raw = bad.course.raw.replace("shelf: systems", "shelf: nowhere");
  await assert.rejects(
    loadCatalog({ courses: [bad] }, { allowLocal: false }),
    /one of foundations, systems/,
  );
  const wrongSlug = course("c");
  wrongSlug.course.raw = wrongSlug.course.raw.replace("slug: c", "slug: d");
  await assert.rejects(
    loadCatalog({ courses: [wrongSlug] }, { allowLocal: false }),
    /"slug" must be "c"/,
  );
  const reserved = course("search");
  await assert.rejects(
    loadCatalog({ courses: [reserved] }, { allowLocal: false }),
    /is a page of the site/,
  );
  await assert.rejects(
    loadCatalog({ courses: [course("a"), course("b")] }, { allowLocal: false }),
    /share shelf and order/,
  );
  const needs = lecture();
  needs.raw = needs.raw.replace("prerequisites: []", "prerequisites: [nothing]");
  await assert.rejects(
    loadCatalog({ courses: [course("c", "", [needs])] }, { allowLocal: false }),
    /prerequisite "nothing" is not a lecture/,
  );
});

test("search needs every word, ranks titles first, and gives a snippet", async () => {
  const catalog = await loadCatalog(readContentDir(sample), { allowLocal: false });
  const hits = search(catalog.lectures, "attention transformer");
  assert.equal(hits[0]?.url, "/how-language-models-work/attention-and-the-transformer");
  assert.deepEqual(search(catalog.lectures, "zzzqqq"), []);
  assert.deepEqual(search(catalog.lectures, "a"), []);
  const body = search(catalog.lectures, "softmax");
  assert.match(body[0]!.snippet, /softmax/i);
  assert.deepEqual(search(catalog.lectures, "attention zzzqqq"), []);
});

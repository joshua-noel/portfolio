import { parse as parseYaml } from "yaml";
import {
  BlockError,
  scanBlocks,
  splitSections,
  type Block,
  type Section,
} from "./blocks.ts";
import { DEPTHS, type Depth } from "./depth.ts";
import { Renderer, type Facts, type Heading } from "./render.ts";
import { sanitizeSvg } from "./svg.ts";

/**
 * One lecture: its front matter, its four depths rendered to HTML, and every
 * structural rule of learn-content/CONTRACT.md as a build-time check. The
 * rules live in this file and nowhere else; the contract describes them and
 * this enforces them.
 */

export const VISIBILITIES = ["public", "members", "friends", "local"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Shelves in the order they stand, with the names readers see. */
export const SHELVES = [
  { id: "foundations", title: "Foundations" },
  { id: "systems", title: "Systems" },
  { id: "language-models", title: "Language models" },
  { id: "agents", title: "Agents" },
  { id: "frontier", title: "Frontier" },
  { id: "special", title: "Special" },
] as const;

export type ShelfId = (typeof SHELVES)[number]["id"];

/** Words per layer the contract asks for; a placeholder is exempt. */
export const WORD_RANGES: Record<Depth, readonly [number, number]> = {
  tip: [250, 350],
  waterline: [1400, 2000],
  deep: [1200, 2000],
  abyss: [1000, 1800],
};

export interface Source {
  id: string;
  title: string;
  url: string;
  usedFor: string;
}

export interface Cover {
  color: string;
  accent: string;
  motif: string;
}

/** The six diagram hues, as the stylesheet names them. */
export const HUES = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
export type Hue = (typeof HUES)[number];

export interface CourseFront {
  slug: string;
  title: string;
  shelf: ShelfId;
  promise: string;
  visibility: Visibility;
  /** Position on its shelf. */
  order: number;
  cover: Cover;
  /** The one hue this course uses for hostile, failing or wasted things; its pages draw it as the alert rose. */
  alert?: Hue;
}

export interface LectureFront {
  course: string;
  order: number;
  slug: string;
  title: string;
  promise: string;
  visibility: Visibility;
  video: boolean;
  /** Reading time of each layer; the layers add up. */
  minutes: Record<Depth, number>;
  objectives: string[];
  prerequisites: string[];
  sources: Source[];
  checked: string;
  /**
   * Site extension to the contract: a stand-in that keeps every kind of block
   * but not the word counts and the number of objectives, questions and
   * diagrams. Used for sample content only.
   */
  placeholder: boolean;
}

/** A piece of rendered body. It is on screen at `layer`, and at deeper layers too. */
export interface Segment {
  layer: Depth;
  html: string;
}

/** The files beside a lecture that the site serves, as found on disk. */
export interface Media {
  video: boolean;
  captions: boolean;
  /** File name of a poster image, if one exists. */
  poster?: string;
}

export interface Lecture {
  course: string;
  slug: string;
  /** `NN-slug`, the name its files share. */
  file: string;
  front: LectureFront;
  /** True when this process may not show the body; `segments` is then empty. */
  locked: boolean;
  segments: Segment[];
  /** The learning objectives as HTML (they may hold maths). */
  objectivesHtml: string[];
  /** Headings the "On this page" list shows: sections and their subsections. */
  toc: Heading[];
  /** Plain text of every layer, for search. */
  text: string;
  media: Media;
  /** Things worth saying that do not fail the build. */
  warnings: string[];
}

/** A source file as the loaders hand it over. */
export interface SourceFile {
  /** Where it came from, for error messages. */
  path: string;
  /** The file name, e.g. `03-one-block.md`. */
  name: string;
  raw: string;
}

/** Diagram sources by `NN-name`, for one course. */
export type Diagrams = ReadonlyMap<string, string>;

export class LectureError extends Error {
  readonly path: string;
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`${path}:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.path = path;
    this.issues = issues;
  }
}

/** Minutes to read the lecture at `depth`: layers add up, and Tip stands alone. */
export function minutesAt(minutes: Record<Depth, number>, depth: Depth): number {
  if (depth === "tip") return minutes.tip;
  return DEPTHS.slice(1, DEPTHS.indexOf(depth) + 1).reduce(
    (sum, d) => sum + minutes[d],
    0,
  );
}

// ---------------------------------------------------------------------------
// Front matter

export interface Split {
  data: unknown;
  body: string;
  /** 1-based line of the file the body starts on. */
  bodyLine: number;
}

export function splitFrontmatter(raw: string): Split {
  const text = raw.replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) throw new Error("the file must open with a '---' front matter block");
  return {
    data: parseYaml(match[1]!),
    body: text.slice(match[0].length),
    bodyLine: match[0].split("\n").length,
  };
}

type Record_ = Record<string, unknown>;

/** Small helpers that collect every complaint instead of stopping at the first. */
class Reader {
  readonly issues: string[] = [];
  readonly data: Record_;
  private readonly where: string;

  constructor(data: unknown, where: string) {
    this.data =
      data !== null && typeof data === "object" && !Array.isArray(data)
        ? (data as Record_)
        : {};
    this.where = where;
  }

  private bad(key: string, expected: string): void {
    this.issues.push(`${this.where}: "${key}" must be ${expected}`);
  }

  text(key: string, from: Record_ = this.data): string {
    const value = from[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    this.bad(key, "text");
    return "";
  }

  int(key: string, from: Record_ = this.data): number {
    const value = from[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
    this.bad(key, "a whole number from 1");
    return 0;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback?: T): T {
    const value = this.data[key] ?? fallback;
    if (allowed.includes(value as T)) return value as T;
    this.bad(key, `one of ${allowed.join(", ")}`);
    return allowed[0]!;
  }

  bool(key: string, fallback?: boolean): boolean {
    const value = this.data[key] ?? fallback;
    if (typeof value === "boolean") return value;
    this.bad(key, "true or false");
    return false;
  }

  list(key: string): unknown[] {
    const value = this.data[key];
    if (Array.isArray(value)) return value;
    this.bad(key, "a list");
    return [];
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** First path segments the learn host uses for itself. */
const RESERVED_SLUGS = new Set(["search", "media"]);

export function readCourse(
  data: unknown,
  dirName: string,
): { front?: CourseFront; issues: string[] } {
  const r = new Reader(data, "course.md front matter");
  const slug = r.text("slug");
  if (RESERVED_SLUGS.has(slug))
    r.issues.push(
      `course.md front matter: "${slug}" is a page of the site, not a course name`,
    );
  if (slug !== "" && (!SLUG.test(slug) || slug !== dirName)) {
    r.issues.push(
      `course.md front matter: "slug" must be "${dirName}", the name of its folder`,
    );
  }
  const cover = (r.data.cover ?? {}) as Record_;
  const color = r.text("color", cover);
  const accent = r.text("accent", cover);
  const motif = r.text("motif", cover);
  if (!HEX.test(color) || !HEX.test(accent))
    r.issues.push('course.md front matter: cover colors are "#rrggbb"');
  if (!/^[a-z-]+$/.test(motif))
    r.issues.push('course.md front matter: cover "motif" is lowercase words');
  const shelf = r.oneOf(
    "shelf",
    SHELVES.map((s) => s.id),
  );
  const asked = r.data.alert;
  let alert: Hue | undefined;
  if (asked !== undefined) {
    if (HUES.includes(asked as Hue)) alert = asked as Hue;
    else r.issues.push(`course.md front matter: "alert" must be one of ${HUES.join(", ")}`);
  }
  const front: CourseFront = {
    slug,
    title: r.text("title"),
    shelf,
    promise: r.text("promise"),
    visibility: r.oneOf("visibility", VISIBILITIES),
    order: r.int("order"),
    cover: { color, accent, motif },
    ...(alert ? { alert } : {}),
  };
  return r.issues.length > 0 ? { issues: r.issues } : { front, issues: [] };
}

const FILE_NAME = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export function readLecture(
  data: unknown,
  fileName: string,
  course: string,
): { front?: LectureFront; issues: string[] } {
  const r = new Reader(data, "front matter");
  const named = FILE_NAME.exec(fileName);
  if (!named) {
    return { issues: [`the file name must be NN-lecture-slug.md, like 03-one-block.md`] };
  }

  const courseName = r.text("course");
  if (courseName !== "" && courseName !== course) {
    r.issues.push(
      `front matter: "course" is "${courseName}" but the folder is "${course}"`,
    );
  }
  const order = r.int("order");
  if (order !== 0 && order !== Number(named[1])) {
    r.issues.push(`front matter: "order" is ${order} but the file name says ${named[1]}`);
  }
  const slug = r.text("slug");
  if (slug !== "" && slug !== named[2]) {
    r.issues.push(
      `front matter: "slug" is "${slug}" but the file name says "${named[2]}"`,
    );
  }

  const minutes = (r.data.minutes ?? {}) as Record_;
  const layers = Object.fromEntries(
    DEPTHS.map((depth) => [depth, r.int(depth, minutes)]),
  ) as Record<Depth, number>;

  const placeholder = r.bool("placeholder", false);
  const objectives = r.list("objectives").map((item) => {
    if (typeof item === "string" && item.trim() !== "") return item.trim();
    r.issues.push('front matter: every item of "objectives" is text');
    return "";
  });
  const [min, max] = placeholder ? [1, 5] : [3, 5];
  if (objectives.length < min || objectives.length > max) {
    r.issues.push(
      `front matter: ${objectives.length} objectives; a lecture has ${min} to ${max}`,
    );
  }

  const seen = new Set<string>();
  const sources = r.list("sources").map((item, index): Source => {
    const s = new Reader(item, `sources[${index}]`);
    const id = s.text("id");
    const url = s.text("url");
    if (id !== "" && !/^[A-Za-z][A-Za-z0-9]*$/.test(id)) {
      s.issues.push(`sources[${index}]: "id" is letters and digits`);
    }
    if (seen.has(id)) s.issues.push(`sources[${index}]: two sources are called ${id}`);
    seen.add(id);
    if (url !== "" && !/^https?:\/\/\S+$/.test(url))
      s.issues.push(`sources[${index}]: "url" is a web address`);
    r.issues.push(...s.issues);
    return { id, title: s.text("title"), url, usedFor: s.text("used_for") };
  });
  if (sources.length === 0)
    r.issues.push("front matter: a lecture lists the sources it was written from");

  const checked = r.text("checked");
  if (checked !== "") {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checked);
    const parsed = day ? new Date(`${checked}T00:00:00Z`) : undefined;
    if (
      !parsed ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== checked
    ) {
      r.issues.push('front matter: "checked" is a date, YYYY-MM-DD');
    } else if (parsed.getTime() > Date.now() + 86_400_000) {
      r.issues.push('front matter: "checked" is in the future');
    }
  }

  const prerequisites =
    r.data.prerequisites === undefined ? [] : r.list("prerequisites").map(String);

  const front: LectureFront = {
    course,
    order,
    slug: named[2]!,
    title: r.text("title"),
    promise: r.text("promise"),
    visibility: r.oneOf("visibility", VISIBILITIES),
    video: r.bool("video"),
    minutes: layers,
    objectives,
    prerequisites,
    sources,
    checked,
    placeholder,
  };
  return r.issues.length > 0 ? { issues: r.issues } : { front, issues: [] };
}

// ---------------------------------------------------------------------------
// Diagrams

/** Colours a diagram may use: the theme's own variables, and nothing literal. */
const ALLOWED_COLOUR =
  /^(?:none|currentColor|transparent|inherit|url\(#[\w-]+\)|var\(--(?:fg|muted|border|surface|accent|c[1-6])\))$/;
const COLOUR_PROPERTY =
  /(?:^|[\s;"'])(fill|stroke|stop-color|flood-color|color)\s*[:=]\s*"?([^;"'>]*)/g;

export function checkDiagram(id: string, source: string): string[] {
  const issues: string[] = [];
  const bad = (message: string): number => issues.push(`diagram ${id}: ${message}`);
  const root = /<svg\b[^>]*>/i.exec(source)?.[0] ?? "";
  if (!/\sviewBox="/i.test(root)) bad("the <svg> needs a viewBox");
  if (/\s(?:width|height)="/i.test(root))
    bad("the <svg> has a viewBox only, no width or height");
  if (!/<title[\s>]/i.test(source)) bad("needs a <title> for screen readers");
  if (!/<desc[\s>]/i.test(source)) bad("needs a <desc> for screen readers");
  if (/<image[\s>]/i.test(source)) bad("embedded images are not allowed; draw it");
  if (/<(?:script|style|foreignObject)[\s>]/i.test(source))
    bad("no <script>, <style> or <foreignObject>");
  if (/\s(?:xlink:)?href\s*=\s*(?!["']?#)/i.test(source)) bad("no external links");
  if (/@font-face|font-family\s*[:=]\s*"?[^;"]*url\(/i.test(source))
    bad("no embedded fonts");
  for (const [, property, raw] of source.matchAll(COLOUR_PROPERTY)) {
    const value = raw!.trim();
    if (value !== "" && !ALLOWED_COLOUR.test(value)) {
      bad(
        `${property}:${value} is not allowed; use currentColor or var(--fg), --muted, --border, --surface, --accent, --c1 to --c6`,
      );
      break;
    }
  }
  // The real check: the file is parsed as a browser would and every element
  // and attribute must be on the list (src/lib/learn/svg.ts). The lint above
  // only words the usual mistakes helpfully.
  for (const issue of sanitizeSvg(source).issues) bad(issue);
  return issues;
}

// ---------------------------------------------------------------------------
// Words, for the contract's ranges

/** Words of prose in Markdown source: no code, no maths, no diagram lines, no markup. */
export function proseWords(markdown: string): number {
  let inFence = false;
  let inMath = false;
  const kept: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*\$\$/.test(line)) {
      if (!/^\s*\$\$.+\$\$\s*$/.test(line)) inMath = !inMath;
      continue;
    }
    if (inMath || line.startsWith("![[")) continue;
    kept.push(line);
  }
  const plain = kept
    .join(" ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\]\([^)]*\)/g, " ");
  return (plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

// ---------------------------------------------------------------------------
// The lecture

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

export interface BuildOptions {
  /**
   * Whether this process may show a lecture of that visibility. When it may
   * not, the front matter is still checked but the body is not rendered.
   */
  shows: (visibility: Visibility) => boolean;
}

/**
 * Parses, renders and checks one lecture. Throws `LectureError` listing every
 * problem found, so one build shows them all rather than one at a time.
 */
export async function buildLecture(
  file: SourceFile,
  course: string,
  diagrams: Diagrams,
  media: ReadonlySet<string>,
  { shows }: BuildOptions,
): Promise<Lecture> {
  const fail = (...issues: string[]): never => {
    throw new LectureError(file.path, issues);
  };

  let split: Split;
  try {
    split = splitFrontmatter(file.raw);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const { front, issues } = readLecture(split.data, file.name, course);
  if (!front) return fail(...issues);
  const render = shows(front.visibility);

  const stem = file.name.replace(/\.md$/, "");
  const poster = ["png", "jpg"]
    .map((ext) => `${stem}.poster.${ext}`)
    .find((name) => media.has(name));
  const lecture: Lecture = {
    course,
    slug: front.slug,
    file: stem,
    front,
    locked: !render,
    segments: [],
    objectivesHtml: [],
    toc: [],
    text: "",
    media: {
      video: media.has(`${stem}.mp4`),
      captions: media.has(`${stem}.vtt`),
      ...(poster ? { poster } : {}),
    },
    warnings: [],
  };
  if (front.video && !(lecture.media.video && lecture.media.captions)) {
    lecture.warnings.push(
      `video: true, but ${stem}.mp4 and ${stem}.vtt are not both there yet`,
    );
  }
  if (!front.video && lecture.media.video) {
    lecture.warnings.push(`${stem}.mp4 exists but the front matter says video: false`);
  }
  if (!render) return lecture;

  let sections: Section[];
  try {
    sections = splitSections(split.body, split.bodyLine);
  } catch (error) {
    return fail(...issues, error instanceof BlockError ? error.message : String(error));
  }

  const renderer = new Renderer(new Set(front.sources.map((source) => source.id)));
  // Waterline's closing sections (check yourself, references) are shown after
  // Deep and Abyss, so the layers read in order and the lecture still ends there.
  const parts = {
    tip: [] as string[],
    waterline: [] as string[],
    tail: [] as string[],
    deep: [] as string[],
    abyss: [] as string[],
  };
  const counts = { figures: 0, questions: 0, words: {} as Record<Depth, number> };
  let inTail = false;

  const target = (layer: Depth): string[] =>
    layer === "waterline" && inTail ? parts.tail : parts[layer];

  const figure = async (
    block: Extract<Block, { type: "diagram" }>,
    layer: Depth,
  ): Promise<string> => {
    counts.figures += layer === "waterline" ? 1 : 0;
    const source = diagrams.get(block.id);
    if (source === undefined) {
      issues.push(
        `line ${block.line}: diagram ${block.id} has no file diagrams/${block.id}.svg`,
      );
      return "";
    }
    issues.push(...checkDiagram(block.id, source));
    const caption = await renderer.renderInline(block.caption, layer);
    // What is inlined is the sanitiser's output, never the file's own text.
    // With any issue the lecture fails to build, so the empty string goes nowhere.
    return figureHtml(block.id, sanitizeSvg(source).html, caption);
  };

  const question = async (
    block: Extract<Block, { type: "details" }>,
    layer: Depth,
  ): Promise<string> => {
    const summary = await renderer.renderInline(block.summary, layer);
    const answer = await renderer.render(block.body, layer);
    return (
      `<details class="question"><summary><span class="q-text">${summary}</span></summary>` +
      `<div class="answer">${answer}</div></details>\n`
    );
  };

  for (const section of sections) {
    const layer = section.layer;
    counts.words[layer] = proseWords(section.text);
    if (
      layer === "tip" &&
      (/\$/.test(section.text) || /^ {0,3}(```|~~~)/m.test(section.text))
    ) {
      issues.push("Tip has no formulas and no code");
    }
    for (const block of scanBlocks(section.text, section.line)) {
      if (block.type === "diagram") {
        target(layer).push(await figure(block, layer));
      } else if (block.type === "details") {
        if (layer === "waterline" && inTail) counts.questions += 1;
        target(layer).push(await question(block, layer));
      } else {
        // The first "## Check yourself" ends the Waterline proper.
        const at =
          layer === "waterline" ? /^## Check yourself\s*$/m.exec(block.text) : null;
        if (at && !inTail) {
          const before = block.text.slice(0, at.index);
          if (before.trim() !== "")
            parts.waterline.push(await renderer.render(before, layer));
          inTail = true;
          parts.tail.push(await renderer.render(block.text.slice(at.index), layer));
        } else {
          target(layer).push(await renderer.render(block.text, layer));
        }
      }
    }
  }
  parts.tail.push(referencesHtml(front));
  issues.push(...renderer.facts.issues);
  checkStructure(front, renderer.facts, counts, issues);
  if (issues.length > 0) fail(...issues);

  lecture.segments = [
    { layer: "tip", html: parts.tip.join("") },
    { layer: "waterline", html: parts.waterline.join("") },
    { layer: "deep", html: parts.deep.join("") },
    { layer: "abyss", html: parts.abyss.join("") },
    { layer: "waterline", html: parts.tail.join("") },
  ].filter((segment) => segment.html.trim() !== "") as Segment[];
  lecture.objectivesHtml = await Promise.all(
    front.objectives.map((objective) => renderer.renderInline(objective, "waterline")),
  );
  // In reading order: Check yourself and References come after Deep and Abyss.
  const headings = renderer.facts.headings.filter((heading) => heading.depth <= 3);
  const closing = headings.findIndex(
    (h) => h.layer === "waterline" && h.frame === "check",
  );
  const waterline = headings.filter((h) => h.layer === "waterline");
  const ahead = closing === -1 ? waterline.length : waterline.indexOf(headings[closing]!);
  lecture.toc = [
    ...waterline.slice(0, ahead),
    ...headings.filter((h) => h.layer === "deep"),
    ...headings.filter((h) => h.layer === "abyss"),
    ...waterline.slice(ahead),
  ];
  lecture.text = `${front.title}. ${front.promise}\n${renderer.facts.text.join("\n")}`;
  return lecture;
}

function figureHtml(id: string, svg: string, caption: string): string {
  const width =
    /\sviewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+[\d.]+\s*"/.exec(svg)?.[1] ?? "600";
  const interactive = /data-interactive="([a-z0-9-]+)"/.exec(svg)?.[1];
  // An image for screen readers unless the diagram has controls of its own.
  const labelled = interactive
    ? svg
    : svg.replace(
        /<svg\b/,
        `<svg role="img" aria-label="${escapeHtml(/<title[^>]*>([\s\S]*?)<\/title>/.exec(svg)?.[1]?.trim() ?? id)}"`,
      );
  return (
    `<figure class="diagram" data-diagram="${id}" style="--w:${Number(width)}"` +
    `${interactive ? ` data-interactive="${interactive}"` : ""}>` +
    `<div class="diagram-body">${labelled}</div><figcaption>${caption}</figcaption></figure>\n`
  );
}

function referencesHtml(front: LectureFront): string {
  const items = front.sources
    .map(
      (source) =>
        `<li id="ref-${source.id}"><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a> ` +
        `<span class="ref-id">[${source.id}]</span>. ${escapeHtml(source.usedFor)}.</li>`,
    )
    .join("");
  return `<ol class="references">${items}</ol><p class="checked">Every source was opened on ${front.checked}.</p>\n`;
}

interface Counts {
  figures: number;
  questions: number;
  words: Record<Depth, number>;
}

function checkStructure(
  front: LectureFront,
  facts: Facts,
  counts: Counts,
  issues: string[],
): void {
  const full = !front.placeholder;
  const sections = (layer: Depth): Heading[] =>
    facts.headings.filter((h) => h.depth === 2 && h.layer === layer);

  // Waterline: idea, 4 to 7 numbered sections, worked example, check, references.
  const water = sections("waterline");
  const numbered = water.filter((h) => h.number !== undefined);
  const frames = water.filter((h) => h.number === undefined).map((h) => h.frame);
  const expected = ["idea", "example", "check", "references"];
  const unknown = water.filter((h) => h.number === undefined && h.frame === undefined);
  for (const h of unknown)
    issues.push(`Waterline: "## ${h.text}" must be numbered, like "## 1. ${h.text}"`);
  for (const name of expected) {
    if (!frames.includes(name as never))
      issues.push(`Waterline: missing the "## ${titleOf(name)}" section`);
  }
  const sequence = water
    .map((h) => (h.number !== undefined ? "n" : (h.frame ?? "?")))
    .join(" ");
  if (
    unknown.length === 0 &&
    expected.every((name) => frames.includes(name as never)) &&
    !/^idea( n)+ example check references$/.test(sequence)
  ) {
    issues.push(
      "Waterline sections come in this order: the idea, the numbered sections, the worked example, check yourself, references",
    );
  }
  if (numbered.map((h) => h.number).join() !== numbered.map((_, i) => i + 1).join()) {
    issues.push("Waterline: the numbered sections count 1, 2, 3, … in order");
  }
  if (numbered.length < 1 || (full && (numbered.length < 4 || numbered.length > 7))) {
    issues.push(`Waterline: ${numbered.length} numbered sections; a lecture has 4 to 7`);
  }
  if (facts.ideaParagraphs !== 1) {
    issues.push(
      `"The idea in one paragraph" has ${facts.ideaParagraphs} paragraphs; it has one`,
    );
  }
  if (full ? counts.questions !== 5 : counts.questions < 1) {
    issues.push(
      `Check yourself has ${counts.questions} questions; it has ${full ? "exactly 5" : "at least 1"}`,
    );
  }
  if (full && counts.figures < 2)
    issues.push(`Waterline has ${counts.figures} diagrams; it has at least two`);

  // Deep and Abyss: their own numbered sections, which count up from 1.
  for (const layer of ["deep", "abyss"] as const) {
    const own = sections(layer);
    const name = layer === "deep" ? "Deep" : "Abyss";
    if (own.length === 0) issues.push(`${name}: needs at least one "## 1. …" section`);
    const unnumbered = own.filter((h) => h.number === undefined);
    if (layer === "deep" && unnumbered.length > 0) {
      issues.push(
        `Deep: "## ${unnumbered[0]!.text}" must be numbered, like "## 1. ${unnumbered[0]!.text}"`,
      );
    }
    const nums = own.filter((h) => h.number !== undefined).map((h) => h.number);
    if (nums.join() !== nums.map((_, i) => i + 1).join()) {
      issues.push(`${name}: the numbered sections count 1, 2, 3, … in order`);
    }
  }

  // Words, and the rules for the Tip.
  if (full) {
    for (const layer of DEPTHS) {
      const [low, high] = WORD_RANGES[layer];
      const words = counts.words[layer];
      if (words < low || words > high) {
        issues.push(
          `${layer[0]!.toUpperCase()}${layer.slice(1)} has ${words} words; the contract asks for ${low} to ${high}`,
        );
      }
    }
  }
  const tipHeadings = facts.headings.filter((h) => h.layer === "tip");
  if (tipHeadings.length > 0) issues.push("Tip has no headings");
}

const titleOf = (frame: string): string =>
  ({
    idea: "The idea in one paragraph",
    example: "Worked example",
    check: "Check yourself",
    references: "References",
  })[frame] ?? frame;

#!/usr/bin/env node
// Build-time check for lecture content: renders every course and lecture and
// enforces learn-content/CONTRACT.md. It reports EVERY error and warning, not
// just the first, grouped by course and then by file, with a one-line summary
// per course and a total. It exits 1 if there is any error.
//
//   node bin/check-learn.mjs [--course <slug>]... [content-dir ...]
//
// With no directory it checks the folders named by PORTFOLIO_LEARN_CONTENT_DIRS
// or PORTFOLIO_LEARN_CONTENT_DIR, or else the sample lectures in this
// repository. Whatever is named, the sample lectures in this repository are
// always checked as well, and must all be `public`: the repository is public,
// so a members, friends or local lecture committed there fails the build, and
// no environment variable can skip that. Several folders are checked
// together, as the server merges them. Every visibility is rendered and
// checked, so a private lecture is held to the same contract.
//
// `--course <slug>` (repeatable) reports only those courses. The other
// courses are still read, because a lecture's `prerequisites` may name a
// lecture of another course.
//
// How it works: each file is built on its own, so one bad file never hides
// the rest. The files that built are then loaded together as a catalog, which
// is what finds the faults between files (prerequisites, clashing orders).
import { existsSync } from "node:fs";
import { basename, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/lib/learn/catalog.ts";
import { readContentDirs } from "../src/lib/learn/disk.ts";
import { interactiveProblems } from "../src/lib/learn/interactive.ts";
import {
  buildLecture,
  LectureError,
  readCourse,
  splitFrontmatter,
} from "../src/lib/learn/lecture.ts";

const sample = fileURLToPath(new URL("../content/learn", import.meta.url));

function usage(message) {
  process.stderr.write(`learn: ${message}\n`);
  process.exit(2);
}

const only = [];
const positional = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--course" || arg.startsWith("--course=")) {
    const slug = arg === "--course" ? args[++i] : arg.slice("--course=".length);
    if (!slug || slug.startsWith("--")) usage("--course needs a course slug");
    only.push(slug);
  } else if (arg.startsWith("--")) usage(`unknown option ${arg}`);
  else positional.push(arg);
}

const fromEnv =
  process.env.PORTFOLIO_LEARN_CONTENT_DIRS?.split(delimiter).filter(Boolean);
const dirs = (
  positional.length > 0
    ? positional
    : (fromEnv ?? [process.env.PORTFOLIO_LEARN_CONTENT_DIR ?? sample])
).map((dir) => resolve(dir));

const content = readContentDirs(dirs);
for (const slug of only) {
  if (!content.courses.some((course) => course.slug === slug))
    usage(`no course called "${slug}" in ${dirs.join(", ")}`);
}

/** @type {{ course: string, file: string, kind: "error" | "warning", text: string }[]} */
const problems = [];
const add = (course, file, kind, text) => problems.push({ course, file, kind, text });
for (const text of content.problems ?? []) add("", "", "error", text);

/** `NN-slug.md` to `slug`, the name other lectures use in `prerequisites`. */
const slugOfFile = (name) => /^\d{2}-(.*)\.md$/.exec(name)?.[1];

// Pass 1: every file on its own.
const failed = new Set(); // lecture slugs that did not build
const good = [];
for (const source of content.courses) {
  let courseOk = true;
  try {
    const split = splitFrontmatter(source.course.raw);
    const { front, issues } = readCourse(split.data, source.slug);
    if (!front) throw new LectureError(source.course.path, issues);
  } catch (error) {
    courseOk = false;
    const issues =
      error instanceof LectureError
        ? error.issues
        : [error instanceof Error ? error.message : String(error)];
    for (const text of issues) add(source.slug, "course.md", "error", text);
  }

  // Interactive diagrams: each module the site has for this course must be declared.
  for (const text of interactiveProblems(source.slug, source.diagrams, resolve(source.dir) === resolve(sample) || resolve(source.dir).startsWith(resolve(sample)))) {
    add(source.slug, "diagrams", "error", text);
  }

  const lectures = [];
  for (const file of source.lectures) {
    try {
      const lecture = await buildLecture(
        file,
        source.slug,
        source.diagrams,
        source.media,
        { shows: () => true },
      );
      for (const text of lecture.warnings) add(source.slug, file.name, "warning", text);
      lectures.push(file);
    } catch (error) {
      if (!(error instanceof LectureError)) throw error;
      const slug = slugOfFile(file.name);
      if (slug) failed.add(slug);
      for (const text of error.issues) add(source.slug, file.name, "error", text);
    }
  }
  if (courseOk) good.push({ ...source, lectures });
  else for (const file of source.lectures) failed.add(slugOfFile(file.name));
}

// Pass 2: the files that built, together. This finds what is wrong between files.
const slugs = content.courses.map((course) => course.slug);
const mentions = (text, slug) =>
  new RegExp(`(^|[ "/])${slug}([ "/:,]|$)`).test(text);

function between(text) {
  const course = slugs.find((slug) => mentions(text, slug)) ?? "";
  const lecture = /^[a-z0-9-]+\/([^:\s]+)/.exec(text)?.[1];
  const file =
    course === "" || lecture === undefined
      ? ""
      : (content.courses
          .find((source) => source.slug === course)
          ?.lectures.find((f) => slugOfFile(f.name) === lecture)?.name ?? "");
  return { course, file };
}

const seen = new Set();
async function loadTogether(courses, repository) {
  try {
    await loadCatalog({ courses }, { allowLocal: true, repository });
  } catch (error) {
    if (!(error instanceof LectureError)) throw error;
    for (const text of error.issues) {
      // A prerequisite on a lecture that failed to build is that lecture's fault.
      const wanted = /prerequisite "([^"]+)" is not a lecture/.exec(text)?.[1];
      if (wanted !== undefined && failed.has(wanted)) continue;
      // "A and B share" and "B and A share" are one fault.
      const key = text.replace(/^(\S+) and (\S+) (share .*)$/, (_, a, b, rest) => `${[a, b].sort().join(" and ")} ${rest}`);
      if (seen.has(key)) continue;
      seen.add(key);
      const { course, file } = between(text);
      add(course, file, "error", text);
    }
  }
}

// The folders asked for are checked as they are. Whatever they are, the
// sample lectures in this repository are checked too, and held to being
// public: the repository is public, so the variable that names a private
// folder must not be a way to skip that.
await loadTogether(good, false);
if (existsSync(sample)) await loadTogether(readContentDirs([sample]).courses, true);

// Report.
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const selected = (course) => only.length === 0 || only.includes(course);
// A fault between files shows if it names any selected course.
const shown = problems.filter((p) =>
  only.length === 0
    ? true
    : p.course === ""
      ? only.some((slug) => mentions(p.text, slug))
      : selected(p.course),
);

const lines = [];
let errors = 0;
let warnings = 0;
let lectureCount = 0;
let courseCount = 0;

function report(heading, list, summary) {
  if (list.length > 0) {
    lines.push(heading);
    const files = [...new Set(list.map((p) => p.file))].sort((a, b) =>
      a === "course.md" ? -1 : b === "course.md" ? 1 : a.localeCompare(b),
    );
    for (const file of files) {
      if (file !== "") lines.push(`  ${file}`);
      for (const p of list.filter((p) => p.file === file))
        lines.push(`    ${p.kind}: ${p.text}`);
    }
  }
  if (summary) lines.push(summary);
  lines.push("");
}

for (const source of content.courses) {
  if (!selected(source.slug)) continue;
  const list = shown.filter((p) => p.course === source.slug);
  const e = list.filter((p) => p.kind === "error").length;
  const w = list.length - e;
  errors += e;
  warnings += w;
  courseCount += 1;
  lectureCount += source.lectures.length;
  report(
    source.slug,
    list,
    `${source.slug}: ${plural(source.lectures.length, "lecture")}, ${plural(e, "error")}, ${plural(w, "warning")}`,
  );
}
const across = shown.filter((p) => p.course === "");
if (across.length > 0) {
  errors += across.filter((p) => p.kind === "error").length;
  warnings += across.filter((p) => p.kind === "warning").length;
  report("(between courses)", across);
}

lines.push(
  `total: ${plural(courseCount, "course")}, ${plural(lectureCount, "lecture")}, ` +
    `${plural(errors, "error")}, ${plural(warnings, "warning")} ` +
    `(${dirs.map((dir) => basename(dir) || dir).join(", ")})`,
);
(errors > 0 ? process.stderr : process.stdout).write(`${lines.join("\n")}\n`);
process.exitCode = errors > 0 ? 1 : 0;

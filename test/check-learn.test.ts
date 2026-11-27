import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAMS, lectureV2, withBody, without, words } from "./helpers/lecture-v2.ts";

const script = fileURLToPath(new URL("../bin/check-learn.mjs", import.meta.url));

function course(root: string, slug: string, order: number, lecture: string): void {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "course.md"),
    `---\nslug: ${slug}\ntitle: ${slug}\nshelf: systems\npromise: A course for the checker test.\nvisibility: public\norder: ${order}\ncover: { color: "#3a3f4b", accent: "#9aa3b5", motif: "grid" }\n---\n\nIntro.\n`,
  );
  writeFileSync(join(dir, "01-broken.md"), lecture);
}

function run(...args: string[]): { status: number | null; text: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, text: result.stdout + result.stderr };
}

test("every course's errors are reported, grouped, with a summary per course", () => {
  const root = mkdtempSync(join(tmpdir(), "check-learn-"));
  try {
    course(root, "alpha", 1, "no front matter here\n");
    course(root, "beta", 2, "---\nslug: nope\n---\n\nBody.\n");

    const all = run(root);
    assert.equal(all.status, 1);
    assert.match(all.text, /^alpha\n {2}01-broken\.md\n {4}error: /m);
    assert.match(all.text, /^beta\n {2}01-broken\.md\n {4}error: /m);
    assert.match(all.text, /^alpha: 1 lecture \(1 still version 1\), [1-9]\d* errors?, 0 warnings$/m);
    assert.match(all.text, /^beta: 1 lecture \(1 still version 1\), [1-9]\d* errors?, 0 warnings$/m);
    assert.match(all.text, /^total: 2 courses, 2 lectures \(2 still version 1\), /m);

    const one = run(root, "--course", "beta");
    assert.equal(one.status, 1);
    assert.doesNotMatch(one.text, /alpha/);
    assert.match(one.text, /^beta: /m);
    assert.match(one.text, /^total: 1 course, 1 lecture \(1 still version 1\), /m);

    const both = run(root, "--course", "alpha", "--course=beta");
    assert.match(both.text, /^total: 2 courses, /m);

    assert.equal(run(root, "--course", "gamma").status, 2);
    assert.equal(run(root, "--course").status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a course with no errors exits 0 even when another course, not selected, has some", () => {
  const root = mkdtempSync(join(tmpdir(), "check-learn-"));
  try {
    course(root, "alpha", 1, "no front matter here\n");
    mkdirSync(join(root, "beta"));
    writeFileSync(
      join(root, "beta", "course.md"),
      `---\nslug: beta\ntitle: beta\nshelf: systems\npromise: An empty course.\nvisibility: public\norder: 2\ncover: { color: "#3a3f4b", accent: "#9aa3b5", motif: "grid" }\n---\n\nIntro.\n`,
    );
    const result = run(root, "--course", "beta");
    assert.equal(result.status, 0, result.text);
    assert.match(result.text, /^beta: 0 lectures \(0 still version 1\), 0 errors, 0 warnings$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A throwaway copy of the checker and the sample lectures, inside the
 * repository's own `.data/` so its imports still find node_modules. The
 * committed `content/learn` is never touched.
 */
function checkerCopy(): { root: string; script: string; sample: string } {
  const base = fileURLToPath(new URL("../", import.meta.url));
  mkdirSync(join(base, ".data"), { recursive: true });
  const root = mkdtempSync(join(base, ".data", "check-copy-"));
  for (const dir of ["bin", "src/lib", "content/learn"]) {
    cpSync(join(base, dir), join(root, dir), { recursive: true });
  }
  return { root, script: join(root, "bin", "check-learn.mjs"), sample: join(root, "content", "learn") };
}

test("the in-repo public-only check runs even when a content folder is named in the environment", () => {
  const copy = checkerCopy();
  const other = mkdtempSync(join(tmpdir(), "check-learn-"));
  try {
    mkdirSync(join(other, "mine"));
    writeFileSync(
      join(other, "mine", "course.md"),
      `---\nslug: mine\ntitle: mine\nshelf: systems\npromise: A private course, outside the repository.\nvisibility: members\norder: 9\ncover: { color: "#3a3f4b", accent: "#9aa3b5", motif: "grid" }\n---\n\nIntro.\n`,
    );
    const env = { ...process.env, PORTFOLIO_LEARN_CONTENT_DIRS: other };
    const check = (): { status: number | null; text: string } => {
      const result = spawnSync(process.execPath, [copy.script], { encoding: "utf8", env });
      return { status: result.status, text: result.stdout + result.stderr };
    };

    // A members course outside the repository is fine, and the sample passes.
    const clean = check();
    assert.equal(clean.status, 0, clean.text);

    // The same course inside the repository's content folder is not, whatever the variable says.
    cpSync(join(other, "mine"), join(copy.sample, "mine"), { recursive: true });
    const leaked = check();
    assert.equal(leaked.status, 1, leaked.text);
    assert.match(leaked.text, /a "members" course must not be committed/);
  } finally {
    rmSync(copy.root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

/** A course folder at `root/c` with a version 2 lecture, its diagrams, and optionally a cover. */
function courseV2(root: string, lecture = lectureV2(), cover?: string): void {
  const dir = join(root, "c");
  mkdirSync(join(dir, "diagrams"), { recursive: true });
  writeFileSync(
    join(dir, "course.md"),
    `---\nslug: c\ntitle: c\nshelf: systems\npromise: A course for the checker test.\nvisibility: public\norder: 1\ncover: { color: "#3a3f4b", accent: "#9aa3b5", motif: "grid" }\n---\n\nIntro.\n`,
  );
  writeFileSync(join(dir, "01-a-lecture.md"), lecture.raw);
  for (const [name, svg] of DIAGRAMS) writeFileSync(join(dir, "diagrams", `${name}.svg`), svg);
  if (cover !== undefined) writeFileSync(join(dir, "cover.svg"), cover);
}

test("a version 2 course passes, and the words of every section are printed when its course is asked for", () => {
  const root = mkdtempSync(join(tmpdir(), "check-learn-"));
  try {
    courseV2(root);
    const quiet = run(root);
    assert.equal(quiet.status, 0, quiet.text);
    assert.match(quiet.text, /^c: 1 lecture \(0 still version 1\), 0 errors, 0 warnings$/m);
    assert.doesNotMatch(quiet.text, /words:/);

    const asked = run(root, "--course", "c");
    assert.equal(asked.status, 0, asked.text);
    assert.match(asked.text, /^ {4}words: 4,\d{3} in all \(the contract asks for 3,000 to 9,000\)$/m);
    assert.match(asked.text, /^ {4} {2} {2}200 {2}In brief {2}\(asked 150 to 350\)$/m);
    assert.match(asked.text, /^ {4} {2}\s*\d+ {2}1\. Section 1$/m);
    assert.match(asked.text, /^ {4} {2}\s*300 {2}In practice {2}\(asked 200 to 700\)$/m);

    assert.match(run(root, "--words").text, /words: 4,\d{3} in all/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a version 2 lecture with errors prints its section words, and the errors count", () => {
  const root = mkdtempSync(join(tmpdir(), "check-learn-"));
  try {
    courseV2(root, lectureV2(withBody("In brief", words(90))));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.text, /error: In brief has 90 words; the contract asks for 150 to 350/);
    assert.match(result.text, /^ {4}words: /m);
    assert.match(result.text, /^c: 1 lecture \(0 still version 1\), 1 error, 0 warnings$/m);

    courseV2(root, lectureV2(without("In practice")));
    assert.match(run(root).text, /error: missing the "## In practice" section/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cover.svg beside course.md is checked: viewBox, no text, nothing that runs", () => {
  const root = mkdtempSync(join(tmpdir(), "check-learn-"));
  const cover = (inner: string, box = "0 0 240 320"): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${inner}</svg>`;
  try {
    courseV2(root, lectureV2(), cover('<rect width="240" height="320" fill="#1f3a5f"/>'));
    const clean = run(root);
    assert.equal(clean.status, 0, clean.text);

    courseV2(root, lectureV2(), cover("<rect/>", "0 0 100 100"));
    assert.match(run(root).text, /cover\.svg: the <svg> has viewBox="0 0 240 320"/);
    courseV2(root, lectureV2(), cover('<text x="1" y="1">Title</text>'));
    assert.match(run(root).text, /cover\.svg: a cover has no text/);
    courseV2(root, lectureV2(), cover("<script>alert(1)</script>"));
    assert.match(run(root).text, /cover\.svg: <script> is not allowed/);
    courseV2(root, lectureV2(), cover('<rect onload="x()"/>'));
    assert.match(run(root).text, /cover\.svg: the event handler onload is not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a formula that does not parse and a malformed diagram line are reported with their file and line, not a stack trace", () => {
  for (const [body, expected] of [
    [`${words(450)} A bad formula $\\badcommand{x}$.`, /^ {4}error: line \d+: the formula "\\badcommand\{x\}" does not parse: Undefined control sequence/m],
    [`${words(450)}\n\n![[diagram: 01-one | no close`, /^ {4}error: line \d+: a diagram line is /m],
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), "check-learn-"));
    try {
      courseV2(root, lectureV2(withBody("1. Section 1", body)));
      const all = run(root);
      assert.equal(all.status, 1, all.text);
      assert.match(all.text, /^c\n {2}01-a-lecture\.md\n/m);
      assert.match(all.text, expected);
      assert.doesNotMatch(all.text, /\n\s+at .*(node:internal|\.mjs|\.ts):\d+/, "no stack trace");
      assert.doesNotMatch(all.text, /ParseError|BlockError/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

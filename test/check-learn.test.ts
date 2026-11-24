import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
    assert.match(all.text, /^alpha: 1 lecture, [1-9]\d* errors?, 0 warnings$/m);
    assert.match(all.text, /^beta: 1 lecture, [1-9]\d* errors?, 0 warnings$/m);
    assert.match(all.text, /^total: 2 courses, 2 lectures, /m);

    const one = run(root, "--course", "beta");
    assert.equal(one.status, 1);
    assert.doesNotMatch(one.text, /alpha/);
    assert.match(one.text, /^beta: /m);
    assert.match(one.text, /^total: 1 course, 1 lecture, /m);

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
    assert.match(result.text, /^beta: 0 lectures, 0 errors, 0 warnings$/m);
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

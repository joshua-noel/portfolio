import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

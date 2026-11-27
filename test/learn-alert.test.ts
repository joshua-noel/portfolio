import { test } from "node:test";
import assert from "node:assert/strict";
import { readCourse } from "../src/lib/learn/lecture.ts";

const base = {
  slug: "demo",
  title: "Demo",
  shelf: "systems",
  promise: "One line.",
  visibility: "public",
  order: 1,
  cover: { color: "#112233", accent: "#ddeeff", motif: "loop" },
};

test("a course may name its alert hue, c1 to c6", () => {
  for (const hue of ["c1", "c2", "c3", "c4", "c5", "c6"]) {
    const { front, issues } = readCourse({ ...base, alert: hue }, "demo");
    assert.deepEqual(issues, []);
    assert.equal(front?.alert, hue);
  }
});

test("the alert key is optional, and a course without it has none", () => {
  const { front, issues } = readCourse(base, "demo");
  assert.deepEqual(issues, []);
  assert.equal(front?.alert, undefined);
  assert.equal("alert" in front!, false);
});

test("an alert hue that is not one of the six is an error that names the choices", () => {
  for (const bad of ["c7", "red", "", 6, null]) {
    const { front, issues } = readCourse({ ...base, alert: bad }, "demo");
    assert.equal(front, undefined);
    assert.match(issues.join("\n"), /"alert" must be one of c1, c2, c3, c4, c5, c6/);
  }
});

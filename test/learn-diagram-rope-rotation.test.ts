import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, FREQ, ropeScore } from "../src/scripts/learn-diagrams/rope-rotation.js";

// Expected values come from the lecture's own rotate() (Waterline, section 3 and
// Worked example, Part A) run unchanged on the vector (1, 0) at 0.1 radian per position.
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);

test("rope rotation: the lecture's worked table, as printed", () => {
  assert.equal(FREQ, 0.1);
  assert.deepEqual(DEFAULTS, { a: [5, 2], b: [10, 7] });
  const rows: [number, number, number, number, number][] = [
    [5, 2, 0.5, 0.2, 0.9553],
    [10, 7, 1.0, 0.7, 0.9553],
    [5, 1, 0.5, 0.1, 0.9211],
    [20, 20, 2.0, 2.0, 1.0],
  ];
  for (const [m, n, qAngle, kAngle, dot] of rows) {
    const r = ropeScore(m, n);
    near(r.qAngle, qAngle);
    near(r.kAngle, kAngle);
    near(r.between, Math.abs(qAngle - kAngle));
    assert.equal(r.dot.toFixed(4), dot.toFixed(4));
  }
  // the diagram's own text: angle between 0.3, cos(0.3) = 0.955, in both circles
  for (const [m, n] of [DEFAULTS.a, DEFAULTS.b]) {
    assert.equal(ropeScore(m, n).between.toFixed(1), "0.3");
    assert.equal(ropeScore(m, n).dot.toFixed(3), "0.955");
  }
});

test("rope rotation: other points agree with the lecture's code", () => {
  near(ropeScore(30, 3).dot, -0.9040721420170611);
  near(ropeScore(0, 25).dot, -0.8011436155469337);
  near(ropeScore(13, 9).dot, 0.9210609940028852);
  near(ropeScore(17, 16).dot, 0.9950041652780257);
  near(ropeScore(30, 30).dot, 1);
});

test("rope rotation: moving both positions by the same amount changes nothing", () => {
  for (const shift of [0, 3, 11, 25]) {
    const r = ropeScore(5 + shift, 2 + shift);
    near(r.dot, ropeScore(5, 2).dot);
    near(r.between, 0.3);
  }
  // and the score does not care which of the two is ahead
  near(ropeScore(2, 5).dot, ropeScore(5, 2).dot);
});

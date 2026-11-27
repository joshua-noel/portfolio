import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, schedule } from "../src/scripts/learn-diagrams/pipeline-bubble.js";

// Expected values come from an event-by-event simulation of the schedule (the check the
// lecture describes in its worked example), run with forward 1 unit, backward 2 units:
// a block starts when its input has arrived and the stage is free, all forwards first.
const start = (p: number, m: number, kind: string) => {
  const blocks = schedule(p, m).blocks.filter((b) => b.kind === kind);
  return Array.from({ length: p }, (_, s) =>
    Array.from({ length: m }, (_, i) => blocks.find((b) => b.stage === s && b.micro === i + 1)!.start),
  ).flat();
};

test("pipeline bubble: the worked example, as printed in the lecture", () => {
  assert.deepEqual(DEFAULTS, { stages: 4, micro: 4 });
  let r = schedule(4, 1);
  assert.deepEqual([r.total, r.work, r.idle], [12, 3, 9]);
  assert.equal(Math.round(r.fraction * 100), 75);
  r = schedule(4, 4);
  assert.deepEqual([r.total, r.work, r.idle], [21, 12, 9]);
  assert.equal(Math.round(r.fraction * 100), 43);
  r = schedule(4, 16);
  assert.deepEqual([r.total, r.work, r.idle], [57, 48, 9]);
  assert.equal(Math.round(r.fraction * 100), 16);
  r = schedule(16, 64);
  assert.equal(Math.round(r.fraction * 100), 19);
});

test("pipeline bubble: the default schedule equals the static diagram", () => {
  // Start times in units, read from the static SVG (x = 96 + start * 594 / 21 + 1).
  assert.deepEqual(start(4, 4, "forward"), [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6]);
  assert.deepEqual(start(4, 4, "backward"), [13, 15, 17, 19, 11, 13, 15, 17, 9, 11, 13, 15, 7, 9, 11, 13]);
  assert.equal(schedule(4, 4).blocks.length, 32);
  // each stage has 9 idle units, in 1, 3, 3 and 2 gaps
  const gaps = schedule(4, 4).gaps;
  assert.deepEqual([0, 1, 2, 3].map((s) => gaps.filter((g) => g.stage === s).length), [1, 3, 3, 2]);
  for (let s = 0; s < 4; s++) assert.equal(gaps.filter((g) => g.stage === s).reduce((a, g) => a + g.length, 0), 9);
});

test("pipeline bubble: other settings agree with the simulation", () => {
  let r = schedule(3, 2);
  assert.deepEqual([r.total, r.work], [12, 6]);
  assert.deepEqual(start(3, 2, "forward"), [0, 1, 1, 2, 2, 3]);
  assert.deepEqual(start(3, 2, "backward"), [8, 10, 6, 8, 4, 6]);
  r = schedule(5, 3);
  assert.deepEqual([r.total, r.work], [21, 9]);
  assert.deepEqual(start(5, 3, "forward"), [0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 6]);
  assert.deepEqual(start(5, 3, "backward"), [15, 17, 19, 13, 15, 17, 11, 13, 15, 9, 11, 13, 7, 9, 11]);
  r = schedule(2, 6);
  assert.deepEqual([r.total, r.work], [21, 18]);
  assert.deepEqual(start(2, 6, "backward"), [9, 11, 13, 15, 17, 19, 7, 9, 11, 13, 15, 17]);
  r = schedule(16, 64);
  assert.deepEqual([r.total, r.work], [237, 192]);
  r = schedule(8, 3);
  assert.deepEqual([r.total, r.work], [30, 9]);
  assert.equal(schedule(1, 5).idle, 0);
  // every case equals (p - 1) / (m + p - 1)
  for (const [p, m] of [[8, 32], [5, 7], [2, 2], [16, 1]]) {
    assert.ok(Math.abs(schedule(p, m).fraction - (p - 1) / (m + p - 1)) < 1e-12);
  }
});

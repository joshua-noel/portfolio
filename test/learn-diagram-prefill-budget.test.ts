import assert from "node:assert/strict";
import { test } from "node:test";
import { chunked, DEFAULTS, whole } from "../src/scripts/learn-diagrams/prefill-budget.js";

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);

test("prefill budget: the table in the lecture's Part B", () => {
  const w = whole(DEFAULTS);
  assert.equal(w.passes, 1);
  assert.equal(Math.round(w.stall), 322);
  assert.equal(Math.round(w.total), 322);

  const a = chunked({ ...DEFAULTS, budget: DEFAULTS.budgetA });
  assert.equal(a.chunk, 2008);
  assert.equal(a.passes, 3);
  assert.equal(Math.round(a.stall), 109);
  assert.equal(Math.round(a.total), 326);

  const b = chunked({ ...DEFAULTS, budget: DEFAULTS.budgetB });
  assert.equal(b.chunk, 472);
  assert.equal(b.passes, 13);
  assert.equal(Math.round(b.stall), 27);
  assert.equal(Math.round(b.total), 348);

  // "a factor of 12" and "8 percent later"
  assert.equal(Math.round(w.stall / b.stall), 12);
  assert.equal(Math.round((b.total / w.total - 1) * 100), 8);
});

test("prefill budget: the lecture's Check yourself (1,000 budget, 100 users, 5,000 prompt)", () => {
  const r = chunked({ prompt: 5000, decoders: 100, budget: 1000 });
  assert.equal(r.chunk, 900);
  assert.equal(r.passes, 6);
  assert.equal(Math.round(r.stall), 53);
});

// Expected values come from the lecture's own simulate() (Deep, section 1),
// run unchanged with one prompt arriving at time 0 and the users already decoding.
test("prefill budget: other settings agree with the lecture's simulator", () => {
  const cases: [number, number, number, number, number, number][] = [
    // prompt, decoders, budget, passes, stall ms, prompt done ms
    [6000, 40, 1024, 7, 54.613333333333344, 335.68],
    [10000, 100, 256, 65, 13.653333333333364, 881.8133333333323],
    [3000, 20, 4096, 1, 161.06666666666666, 161.06666666666666],
    [2500, 10, 300, 9, 16.0, 138.13333333333333],
  ];
  for (const [prompt, decoders, budget, passes, stall, total] of cases) {
    const r = chunked({ prompt, decoders, budget });
    assert.equal(r.passes, passes);
    near(r.stall, stall);
    near(r.total, total, 1e-6);
  }
});

test("prefill budget: a budget the decodes fill has no room for the prompt", () => {
  assert.throws(() => chunked({ prompt: 6000, decoders: 40, budget: 40 }), RangeError);
});

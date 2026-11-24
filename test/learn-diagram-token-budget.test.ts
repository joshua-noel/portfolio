import assert from "node:assert/strict";
import { test } from "node:test";
import { assemble, DEFAULTS } from "../src/scripts/learn-diagrams/token-budget.js";

// Expected values come from the lecture's own assemble() (Deep, section 1),
// run unchanged for each setting. Order of results here is oldest first.
const run = (over: Record<string, unknown> = {}) => assemble({ ...DEFAULTS, ...over });

test("token budget: the worked example, as printed in the lecture", () => {
  const r = run();
  assert.equal(r.raw, 38790);
  assert.equal(r.budget, 30000);
  assert.equal(r.raw - r.budget, 8790);
  assert.equal(r.total, 24615);
  assert.equal(r.left, 5385);
  assert.deepEqual(r.results, [25, 2300, 9800]);
  assert.equal(r.history, 1500);
});

test("token budget: other settings agree with the lecture's code", () => {
  let r = run({ window: 64000 });
  assert.deepEqual([r.total, r.left, r.results], [30790, 31210, [6200, 2300, 9800]]);
  r = run({ window: 24000 });
  assert.deepEqual([r.total, r.left, r.results], [21015, 985, [6200, 2300, 25]]);
  r = run({ reserve: 4000, tools: 20, memory: 1000, history: 15000, passages: 14, results: [3000, 8000, 5000], cap: 2500 });
  assert.deepEqual([r.total, r.left, r.results], [26675, 1325, [3000, 25, 5000]]);
});

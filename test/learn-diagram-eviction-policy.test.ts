import assert from "node:assert/strict";
import { test } from "node:test";
import { PARAMS, run } from "../src/scripts/learn-diagrams/eviction-policy.js";

// The lecture's "Pressure" paragraph has no code block, so the reference numbers
// come from a line-by-line transcription of that paragraph, run with Python.
const at = (policy: string, n: number, over: Record<string, number> = {}) => {
  const r = run(policy, 60, { ...PARAMS, ...over });
  return { ...r.points[n], flushes: r.flushes };
};

test("eviction: the lecture's pressure example, as printed", () => {
  const r = run("memgpt", 60);
  assert.equal(r.warnAt, 5600);
  assert.deepEqual(r.points[18], { n: 18, before: 5700, after: 5700 });
  assert.deepEqual(r.points[28], { n: 28, before: 8200, after: 4500 });
  assert.deepEqual(r.points[43], { n: 43, before: 8250, after: 4250 });
  assert.deepEqual(r.points[59], { n: 59, before: 8250, after: 4250 });
  assert.deepEqual(r.flushes, [28, 43, 59]);
  assert.equal(r.points[0].after, 1200);
  assert.equal(r.points[27].after, 7950);
});

test("eviction: the first flush evicts messages 1 to 16 into the recall store", () => {
  const r = run("memgpt", 28);
  assert.deepEqual(r.recall, Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(r.kept, Array.from({ length: 12 }, (_, i) => i + 17));
  assert.deepEqual(r.lost, []);
  assert.equal(r.tokens, 4500);
});

test("eviction: other settings agree with the paragraph's arithmetic", () => {
  const a = run("memgpt", 40);
  assert.deepEqual([a.points[40].after, a.kept.length, a.recall.length, a.flushes], [7500, 24, 16, [28]]);
  const b = at("memgpt", 60, { evict: 8 });
  assert.deepEqual([b.after, b.flushes], [6500, [28, 35, 43, 51, 59]]);
  const c = at("memgpt", 60, { evict: 24 });
  assert.deepEqual([c.after, c.flushes], [4500, [28, 51]]);
  assert.deepEqual(run("memgpt", 28, { ...PARAMS, evict: 24 }).kept.length, 4);
  assert.equal(at("memgpt", 28, { evict: 24 }).after, 2500);
});

test("eviction: comparison policies (not worked in the lecture)", () => {
  const f = run("fifo", 60);
  assert.deepEqual(f.points[28], { n: 28, before: 8200, after: 7950 });
  assert.deepEqual(f.points[60], { n: 60, before: 8200, after: 7950 });
  assert.equal(f.flushes[0], 28);
  assert.equal(f.lost.length, 33);
  assert.deepEqual(f.recall, []);
  const never = run("never", 60);
  assert.equal(never.points[60].after, 16200);
  assert.deepEqual(never.flushes, []);
  assert.equal(run("never", 40).tokens, 11200);
});

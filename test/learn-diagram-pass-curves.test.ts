import assert from "node:assert/strict";
import { test } from "node:test";
import { COUNTS, curves, N, passAtK, passHatK } from "../src/scripts/learn-diagrams/pass-curves.js";

// Reference values come from the lecture's own pass_hat_k and pass_at_k (Deep, section 1),
// run unchanged with Python; the independent-trial values are 1 - (1 - p)^k and p^k.
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("pass curves: the worked example, as printed in the lecture", () => {
  assert.equal(Math.round(passHatK(COUNTS, N, 3) * 1e4) / 1e4, 0.4425);
  assert.equal(Math.round(passAtK(COUNTS, N, 3) * 1e4) / 1e4, 0.7892);
  const row = curves("tasks", 0);
  assert.equal((row[0].at * 100).toFixed(1), "62.0");
  assert.equal((row[2].at * 100).toFixed(1), "78.9");
  assert.equal((row[2].hat * 100).toFixed(1), "44.3");
  assert.equal((row[9].hat * 100).toFixed(1), "30.0");
});

test("pass curves: other points of the lecture's estimators", () => {
  near(passAtK(COUNTS, N, 2), 0.7355555555555555);
  near(passHatK(COUNTS, N, 2), 0.5044444444444445);
  near(passHatK(COUNTS, N, 5), 0.375);
  near(passAtK(COUNTS, N, 8), 0.88);
  near(passHatK(COUNTS, N, 8), 0.32222222222222224);
  near(passAtK(COUNTS, N, 10), 0.9);
  const seven = Array(10).fill(7);
  near(passAtK(seven, 10, 4), 1);
  near(passHatK(seven, 10, 4), 0.16666666666666666);
  near(passHatK(seven, 10, 10), 0);
  near(passAtK([10, 0, 5, 5], 10, 2), 0.6388888888888888);
  near(passHatK([10, 0, 5, 5], 10, 7), 0.25);
});

test("pass curves: one per-trial rate, as printed (p = 0.75)", () => {
  const rows = curves("rate", 0.75);
  assert.equal(rows.length, 10);
  assert.deepEqual([rows[0].at, rows[0].hat], [0.75, 0.75]);
  assert.equal(Math.round(rows[2].hat * 100), 42);
  assert.equal(Math.round(rows[2].at * 100), 98);
  assert.equal(Math.round(rows[9].hat * 100), 6);
  assert.equal(Math.round(rows[9].at * 100), 100);
});

test("pass curves: other rates and k", () => {
  const at = (p: number, k: number) => curves("rate", p)[k - 1];
  near(at(0.9, 5).hat, 0.5904900000000001);
  near(at(0.5, 4).at, 0.9375);
  near(at(0.5, 4).hat, 0.0625);
  near(at(0.3, 7).at, 0.9176457);
  near(at(0.3, 7).hat, 0.0002187);
  near(at(0.95, 10).hat, 0.5987369392383787);
  assert.deepEqual([at(0, 3).at, at(0, 3).hat, at(1, 3).at, at(1, 3).hat], [0, 0, 1, 1]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, firstLoss, plain, ratio, spec, tokensPerRound } from "../src/scripts/learn-diagrams/speculative-speedup.js";

const near = (actual: number, expected: number, relative = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${actual} is not ${expected}`);

const { alpha, gamma } = DEFAULTS;

test("speculative speedup: the table in the lecture's Part C", () => {
  const table: [number, number, number, number][] = [
    // batch, plain, with speculation, ratio (as printed)
    [1, 125, 336, 2.69],
    [32, 4000, 10212, 2.55],
    [64, 8000, 11284, 1.41],
    [100, 12500, 11727, 0.94],
    [150, 18750, 12006, 0.64],
  ];
  for (const [B, p, s, r] of table) {
    assert.equal(Math.round(plain(B)), p);
    assert.equal(Math.round(spec(B, alpha, gamma)), s);
    assert.equal(Math.round(ratio(B, alpha, gamma) * 100) / 100, r);
  }
  assert.equal(firstLoss(alpha, gamma), 94);
  assert.equal(DEFAULTS.batch, 94);
});

test("speculative speedup: tokens per round, as printed in the lecture and the paper's Table 1", () => {
  const rounded = (a: number, g: number) => Math.round(tokensPerRound(a, g) * 100) / 100;
  assert.equal(rounded(0.8, 4), 3.36);
  assert.equal(rounded(0.8, 5), 3.69);
  assert.equal(rounded(0.6, 2), 1.96);
  assert.equal(rounded(0.7, 3), 2.53);
  assert.equal(rounded(0.9, 10), 6.86);
});

test("speculative speedup: a lower acceptance rate loses sooner (ratio 0.97 at batch 64)", () => {
  assert.equal(Math.round(ratio(64, 0.6, 4) * 100) / 100, 0.97);
});

// Expected values come from the lecture's own code (Deep, section 5), run
// unchanged with alpha and gamma replaced.
test("speculative speedup: other settings agree with the lecture's code", () => {
  const cases: [number, number, number, number, [number, number][]][] = [
    // alpha, gamma, tokens per round, first batch where speculation loses, [batch, tokens per second]
    [0.6, 4, 2.3056, 62, [[1, 230.56], [64, 7739.076923076923], [100, 8042.790697674418], [150, 8234.285714285716]]],
    [0.8, 7, 4.161139200000001, 70, [[1, 361.8381913043479], [64, 8644.651876217271], [150, 9246.976000000002]]],
    [0.5, 2, 1.75, 82, [[1, 194.44444444444446], [64, 9964.4128113879], [100, 10294.117647058823]]],
    [0.95, 10, 8.623998154470799, 110, [[1, 663.3844734208308], [64, 12972.48233828262], [150, 13909.674442694837]]],
    [0.3, 1, 1.3, 93, [[1, 152.94117647058826], [100, 11641.791044776119], [150, 11818.181818181818]]],
  ];
  for (const [a, g, tokens, first, points] of cases) {
    near(tokensPerRound(a, g), tokens);
    assert.equal(firstLoss(a, g), first);
    for (const [B, s] of points) near(spec(B, a, g), s);
  }
  near(plain(200), 18750);
});

test("speculative speedup: a free acceptance of 1 gives gamma + 1 tokens", () => {
  assert.equal(tokensPerRound(1, 4), 5);
});

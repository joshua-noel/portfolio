import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, distribution, LOGITS, TOKENS } from "../src/scripts/learn-diagrams/temperature.js";

// Expected values come from the lecture's own code (next_probs and the sample() top-p
// rule, run unchanged on GPT-2 small with `The cat sat on the`), once for each T.
const pct1 = (p: number) => (p * 100).toFixed(1);
const near = (actual: number, expected: number, tol = 5e-6) => assert.ok(Math.abs(actual - expected) < tol, `${actual} vs ${expected}`);

test("temperature: the three panels of the lecture's diagram, as printed", () => {
  assert.deepEqual(DEFAULTS, [0.5, 1, 1.5]);
  assert.deepEqual(TOKENS, ["floor", "bed", "couch", "ground", "edge", "sofa", "back", "bench"]);
  const printed = {
    0.5: { bars: [32.9, 17.4, 11.7, 7.9, 7.6, 4.1, 3.5, 2.6], choices: 10, nucleus: 9 },
    1: { bars: [8.7, 6.3, 5.2, 4.2, 4.2, 3.1, 2.8, 2.4], choices: 239, nucleus: 769 },
    1.5: { bars: [1.9, 1.6, 1.4, 1.2, 1.2, 1.0, 0.9, 0.8], choices: 3388, nucleus: 7687 },
  };
  for (const [T, want] of Object.entries(printed)) {
    const d = distribution(Number(T));
    assert.deepEqual(d.probs.map(pct1), want.bars.map((x) => x.toFixed(1)));
    assert.equal(Math.round(d.choices), want.choices);
    assert.equal(d.nucleus, want.nucleus);
  }
  // the widths drawn in the static file: 404.256, 106.45, 23.6317 px at 430 / 0.35 px per unit
  const px = (T: number) => distribution(T).top * (430 / 0.35);
  near(px(0.5), 404.256, 0.01);
  near(px(1), 106.45, 0.01);
  near(px(1.5), 23.6317, 0.01);
});

test("temperature: the lecture's own softmax relations hold", () => {
  const d = distribution(1);
  // Deep, section 1: ln p(floor) = -81.29 + 78.85 = -2.45, p = 0.087; entropy 5.48 nats = 239 choices
  near(Math.log(d.top), -2.45, 0.005);
  near(d.entropy, 5.48, 0.005);
  // the floor logit minus the bed logit is 0.32 and the probabilities are in the ratio e^0.32 = 1.38
  near(LOGITS[0] - LOGITS[1], 0.32, 0.005);
  near(d.probs[0] / d.probs[1], Math.exp(0.32), 0.001);
  // the ratio of any two tokens at T is exp(logit difference / T)
  for (const T of [0.25, 0.5, 2]) {
    const x = distribution(T);
    near(x.probs[0] / x.probs[7], Math.exp((LOGITS[0] - LOGITS[7]) / T), 1e-9 * Math.exp((LOGITS[0] - LOGITS[7]) / T));
  }
});

test("temperature: other settings agree with the lecture's code", () => {
  const rows: [number, number[], number, number][] = [
    [0.1, [0.954212, 0.038964, 0.005398, 0.000768, 0.00061, 2.9e-5, 1.3e-5, 3e-6], 1.234, 1],
    [0.25, [0.641131, 0.178384, 0.080906, 0.037083, 0.033825, 0.010052, 0.007193, 0.004026], 3.269, 3],
    [0.8, [0.15447, 0.103567, 0.080894, 0.063393, 0.061597, 0.042158, 0.037971, 0.031673], 57.245, 115],
    [1.2, [0.046778, 0.035834, 0.030392, 0.025833, 0.025343, 0.019682, 0.018356, 0.016266], 869.828, 2735],
    [2, [0.005748, 0.004899, 0.004438, 0.004025, 0.003979, 0.003419, 0.003279, 0.00305], 10667.396, 15602],
  ];
  for (const [T, probs, choices, nucleus] of rows) {
    const d = distribution(T);
    // logits and ln-sums are stored to 5 decimals (relative error about 1e-4 at T = 0.1); expected values are printed to 6
    d.probs.forEach((p, i) => near(p, probs[i], 3e-4 * probs[i] + 6e-7));
    near(d.choices, choices, 0.01 + choices * 1e-5);
    assert.equal(d.nucleus, nucleus);
  }
});

test("temperature: only temperatures with a recorded run are accepted", () => {
  assert.throws(() => distribution(0.52), RangeError);
  assert.throws(() => distribution(2.5), RangeError);
});

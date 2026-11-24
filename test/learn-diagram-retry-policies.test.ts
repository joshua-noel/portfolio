import assert from "node:assert/strict";
import { test } from "node:test";
import { policies, simulate, spread } from "../src/scripts/learn-diagrams/retry-policies.js";

const near = (got: number, want: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(got - want) <= tolerance, `${what}: got ${got}, want ${want} within ${tolerance}`);

// The lecture prints the retry-storm model's step rule, the four policy branches and one
// random run's results, not the whole program or its seed. So the model follows each
// rejected request's distribution (the expected value) and is checked two ways:
// against the lecture's printed numbers, with the spread a single run has (the same model
// run 30 times with random draws gave 3,300 and 190 immediate, 990 and 446 budget), and
// against an independent Python port of the same equations (values below).

test("retry policies: the figures printed in the lecture and the static diagram", () => {
  const r = policies();
  assert.equal(r.none.offered, 900);
  near(r.none.goodput, 456, 0.5, "no retry goodput"); // 455.56
  assert.equal(r.budget.offered, 990); // 900 new plus 0.1 per new request in retries
  near(r.budget.goodput, 445, 1, "budget goodput");
  near(r.immediate.offered, 3312, 10, "immediate offered"); // one random run printed 3,312
  near(r.immediate.goodput, 182, 7, "immediate goodput");
  near(r.backoff.offered, 3307, 5, "backoff offered");
  near(r.backoff.goodput, 187, 2, "backoff goodput");
  // The lecture's point: jitter does not reduce the number of retries while the backend is overloaded.
  near(r.backoff.offered, r.immediate.offered, 1e-6, "backoff against immediate");
  assert.ok(r.immediate.goodput < r.none.goodput / 2); // cut by more than half
  assert.ok(r.budget.goodput > 440); // close to the no-retry level
});

test("retry policies: the lecture's table by rejection cost", () => {
  // Reject cost 0: no retry 501, immediate 497, budget 502 (single runs; the model gives 500).
  let r = policies({ rej: 0 });
  near(r.none.goodput, 501, 2, "0 none");
  near(r.immediate.goodput, 497, 4, "0 immediate");
  near(r.budget.goodput, 502, 3, "0 budget");
  // Reject cost 0.3: 327, 0, 290.
  r = policies({ rej: 0.3 });
  near(r.none.goodput, 327, 2, "0.3 none");
  assert.equal(r.immediate.goodput, 0);
  near(r.budget.goodput, 290, 0.5, "0.3 budget");
});

const PYTHON = [
  { options: {}, none: [900,455.555556], immediate: [3303.401245,188.510973], backoff: [3303.401245,188.510973], budget: [990,445.555556] },
  { options: {rej: 0}, none: [900,500], immediate: [2724.744871,500], backoff: [2724.744871,500], budget: [990,500] },
  { options: {rej: 0.3}, none: [900,328.571429], immediate: [3600,0], backoff: [3600,0], budget: [990,290] },
  { options: {tries: 1}, none: [900,455.555556], immediate: [1584.428877,379.507903], backoff: [1584.428877,379.507903], budget: [990,445.555556] },
  { options: {tries: 6}, none: [900,455.555556], immediate: [6300,0], backoff: [6300,0], budget: [990,445.555556] },
  { options: {cap: 300}, none: [900,233.333333], immediate: [3600,0], backoff: [3600,0], budget: [990,223.333333] },
  { options: {cap: 900}, none: [900,900], immediate: [900,900], backoff: [900,900], budget: [900,900] },
  { options: {base: 0.5}, none: [900,455.555556], immediate: [3303.401245,188.510973], backoff: [3303.388079,188.512436], budget: [990,445.555556] },
  { options: {base: 2}, none: [900,455.555556], immediate: [3303.401245,188.510973], backoff: [3220.691982,197.700891], budget: [990,445.555556] },
  { options: {jitter: false,base: 0.5}, none: [900,455.555556], immediate: [3303.401245,188.510973], backoff: [3300.594789,188.822801], budget: [990,445.555556] },
  { options: {ratio: 0.3}, none: [900,455.555556], immediate: [3303.401245,188.510973], backoff: [3303.401245,188.510973], budget: [1170,425.555556] },
  { options: {tries: 5,rej: 0.2,cap: 400,base: 1,ratio: 0.05}, none: [900,275], immediate: [5400,0], backoff: [5227.304063,0], budget: [945,263.75] },
];

test("retry policies: other settings agree with an independent port of the lecture's equations", () => {
  for (const e of PYTHON) {
    const r = policies(e.options);
    for (const key of ["none", "immediate", "backoff", "budget"] as const) {
      near(r[key].offered, e[key][0], 1e-4, `${JSON.stringify(e.options)} ${key} offered`);
      near(r[key].goodput, e[key][1], 1e-4, `${JSON.stringify(e.options)} ${key} goodput`);
    }
  }
});

test("retry policies: waits change when retries land, not how many, in the steady state", () => {
  const immediate = simulate("immediate", { tries: 1 });
  const jittered = simulate("backoff", { tries: 1 });
  const plain = simulate("backoff", { tries: 1, jitter: false, base: 0.3 });
  near(jittered.offered, immediate.offered, 1e-6, "one retry, jitter");
  near(plain.offered, immediate.offered, 1e-6, "one retry, no jitter");
});

// Section 2 of the lecture: 1,000 clients fail together and retry 4 times, base 1 s.
// Printed: without jitter all 1,000 retried in one 100 ms bucket, four times in a row (peak 1,000);
// with full jitter the peak was 151 over 136 buckets (one random run; the same test run
// with 8 random seeds gave peaks of 151 to 168 over 133 to 137 buckets).
test("retry policies: the lecture's jitter test, as expected values", () => {
  assert.deepEqual(spread({ jitter: false }), { peak: 1000, buckets: 4 });
  const j = spread({ jitter: true });
  near(j.peak, 153.749616, 1e-4, "jitter peak"); // an independent Python port of the same convolution
  assert.equal(j.buckets, 137);
  near(j.peak, 151, 5, "against the lecture's run");
  near(j.buckets, 136, 2, "buckets against the lecture's run");
  // Other points from the same independent port.
  let o = spread({ jitter: true, base: 0.5, tries: 3 });
  near(o.peak, 301.62, 1e-3, "base 0.5, 3 retries");
  assert.equal(o.buckets, 34);
  o = spread({ jitter: true, base: 2, tries: 4 });
  near(o.peak, 77.637083, 1e-4, "base 2, 4 retries"); // the 10 s cap applies to the fourth wait
  assert.equal(o.buckets, 213);
  o = spread({ jitter: true, tries: 6 });
  near(o.peak, 153.755524, 1e-4, "6 retries");
  assert.equal(o.buckets, 290);
});

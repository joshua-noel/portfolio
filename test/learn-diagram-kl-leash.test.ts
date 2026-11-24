import assert from "node:assert/strict";
import { test } from "node:test";
import { BETAS, DEFAULTS, policy } from "../src/scripts/learn-diagrams/kl-leash.js";

const close = (actual: number[], expected: number[], digits = 4) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 10 ** -digits, `${x} vs ${expected[i]}`));
};

// Expected values come from the lecture's own closed form
// (target = pi_ref * exp(r / beta); target /= target.sum(), Deep section 2),
// run with numpy for each beta, plus expected reward and KL(pi* || pi_ref).
test("kl leash: the worked example, as printed in the lecture", () => {
  const r = policy(0.5);
  close(r.p, [0.7488, 0.2027, 0.0411, 0.0074]);
  assert.equal(r.expected.toFixed(2), "1.69");
  assert.equal(r.kl.toFixed(2), "1.40");
  let w = policy(10);
  assert.equal(w.expected.toFixed(2), "0.10");
  assert.equal(w.kl.toFixed(3), "0.005");
  w = policy(2);
  assert.equal(w.expected.toFixed(2), "0.55");
  assert.equal(w.kl.toFixed(2), "0.14");
  w = policy(0.1);
  assert.equal(w.expected.toFixed(2), "2.00");
  assert.equal(w.kl.toFixed(2), "2.30");
});

test("kl leash: the default bars equal the static diagram", () => {
  assert.equal(BETAS[BETAS.indexOf(DEFAULTS.beta)], 0.5);
  // bar heights are probability * 200 in the static SVG
  close(policy(2).p.map((x) => x * 200), [47.5147, 57.6383, 52.4391, 42.4079], 3);
  close(policy(0.5).p.map((x) => x * 200), [149.753, 40.5337, 8.22847, 1.4848], 3);
  close(policy(0.1).p.map((x) => x * 200), [199.982, 0.0181583, 1.23658e-6, 7.48542e-11], 3);
});

test("kl leash: other settings agree with the lecture's code", () => {
  let r = policy(1);
  close(r.p, [0.4271837517, 0.3143042397, 0.1734391021, 0.0850729066], 8);
  assert.ok(Math.abs(r.expected - 1.083599) < 1e-5);
  assert.ok(Math.abs(r.kl - 0.535643) < 1e-5);
  r = policy(0.3);
  close(r.p, [0.9299319628, 0.06634877331, 0.003550388546, 0.0001688753832], 8);
  assert.ok(Math.abs(r.expected - 1.926044) < 1e-5);
  assert.ok(Math.abs(r.kl - 1.983421) < 1e-5);
  r = policy(20);
  close(r.p, [0.1103776759, 0.2099889862, 0.2996215537, 0.3800117842], 8);
  assert.ok(Math.abs(r.kl - 0.001274) < 1e-6);
  r = policy(0.05);
  assert.ok(r.p[0] > 0.9999999 && Math.abs(r.kl - 2.302585) < 1e-5);
});

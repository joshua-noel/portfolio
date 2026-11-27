// System Design, lecture 6, Deep section 1: the retry-storm model. 0.1-second
// steps; the backend does C*dt of work per step; serving a request costs 1 and
// rejecting one costs `rej` (0.1), so with L requests in a step the served
// fraction is p = (C*dt/L - rej) / (1 - rej), kept between 0 and 1. The four
// policies differ only in what happens to a rejected request (the lecture's
// code): none, immediate (next step), backoff_jitter (wait uniform(0, min(10,
// 0.1 * 2**attempt))), budget (the same wait, if the budget holds a token; the
// budget gains 0.1 per new request). The lecture prints the whole simulation and
// the output of one seeded run (seed=1). This port draws no random numbers: it
// follows each rejected request's distribution instead, which gives the
// expected values that the seeded run scatters around.
import { label, panel, redraw, svgEl, thousands } from "./controls.js";

export const DEFAULTS = { tries: 3, rej: 0.1, cap: 500, base: 0.1, jitter: true, ratio: 0.1 };
export const NEW = 900; // new requests per second
export const FAULT = 30; // seconds
export const WARM = 10; // seconds skipped before averaging (see simulate)
const DT = 0.1;

/**
 * Offered and goodput, in requests per second, for one policy:
 * "none", "immediate", "backoff" (the lecture's backoff_jitter) or "budget".
 * Averaged over seconds WARM to FAULT of the fault: the lecture's printed
 * figures sit at the steady state, which the first seconds have not reached.
 */
export function simulate(policy, options = {}) {
  const { tries, rej, cap, base, jitter, ratio } = { ...DEFAULTS, ...options };
  const steps = Math.round(FAULT / DT), warm = Math.round(WARM / DT), arrivals = NEW * DT;
  const q = Array.from({ length: steps + 150 }, () => new Float64Array(tries + 1));
  let budget = 0, offered = 0, good = 0;
  for (let s = 0; s < steps; s++) {
    q[s][0] += arrivals;
    budget += ratio * arrivals;
    let load = 0;
    for (const n of q[s]) load += n;
    const p = Math.min(1, Math.max(0, (cap * DT / load - rej) / (1 - rej)));
    if (s >= warm) { offered += load; good += p * load; }
    for (let a = 0; a < tries; a++) {
      let r = q[s][a] * (1 - p);
      if (policy === "none" || r <= 0) continue;
      if (policy === "budget") { r = Math.min(r, budget); budget -= r; if (r <= 0) continue; }
      if (policy === "immediate") { q[s + 1][a + 1] += r; continue; }
      const wait = Math.min(10, base * 2 ** a); // retry_after(uniform(0, wait)), or exactly `wait` without jitter
      if (!jitter) { q[s + 1 + Math.floor(wait / DT + 1e-9)][a + 1] += r; continue; }
      for (let k = 0; k * DT < wait - 1e-12; k++) q[s + 1 + k][a + 1] += r * Math.min(DT, wait - k * DT) / wait;
    }
  }
  const seconds = (steps - warm) * DT;
  return { offered: offered / seconds, goodput: good / seconds };
}

/** The four rows of the diagram, in order. */
export function policies(options = {}) {
  return {
    none: simulate("none", options),
    immediate: simulate("immediate", options),
    backoff: simulate("backoff", options),
    budget: simulate("budget", options),
  };
}

/**
 * The lecture's Deep section 2 test: `clients` fail at the same moment and each retries `tries`
 * times, sleeping min(cap, base * 2**n) before retry n (full jitter: a random time between 0
 * and that). Returns the busiest 100 ms bucket and how many buckets hold a retry, as expected
 * values (the lecture printed one random run: 1,000 in one bucket without jitter; 151 over 136
 * buckets with it).
 */
export function spread({ jitter, clients = 1000, tries = 4, base = 1, cap = 10 }) {
  const FINE = 0.01, PER_BUCKET = 10;
  const waits = Array.from({ length: tries }, (_, n) => Math.min(cap, base * 2 ** n));
  const size = Math.ceil(waits.reduce((a, b) => a + b, 0) / FINE) + 2;
  let at = new Float64Array(size);
  at[0] = 1; // all clients start at time 0
  const total = new Float64Array(size);
  for (const wait of waits) {
    const k = Math.round(wait / FINE);
    const next = new Float64Array(size);
    if (jitter) {
      let run = 0; // sum of at[i-k+1 .. i]: uniform(0, wait) spreads each cell over k cells
      for (let i = 0; i < size; i++) { run += at[i] - (i >= k ? at[i - k] : 0); next[i] = run / k; }
    } else for (let i = k; i < size; i++) next[i] = at[i - k];
    at = next;
    for (let i = 0; i < size; i++) total[i] += at[i];
  }
  let peak = 0, buckets = 0;
  for (let i = 0; i < size; i += PER_BUCKET) {
    let sum = 0;
    for (let j = i; j < Math.min(size, i + PER_BUCKET); j++) sum += total[j];
    sum *= clients;
    if (sum > peak) peak = sum;
    if (sum > 0.5) buckets++;
  }
  return { peak, buckets };
}

const X = 20, SCALE_AT = 3400, SCALE_PX = 470; // 3,400 requests per second is 470 px, as in the static diagram

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const d = DEFAULTS;
  const ui = panel(svg, draw);
  const get = {
    tries: ui.slider({ label: "Retries after the first attempt", min: 0, max: 6, value: d.tries }),
    rej: ui.slider({ label: "Cost of a rejection (served = 1)", min: 0, max: 0.5, step: 0.05, value: d.rej }),
    cap: ui.slider({ label: "Backend capacity in the fault (per second)", min: 100, max: 1000, step: 50, value: d.cap, format: thousands }),
    base: ui.slider({ label: "Backoff base (seconds)", min: 0.1, max: 2, step: 0.1, value: d.base }),
    ratio: ui.slider({ label: "Retry budget (% of new requests)", min: 0, max: 50, step: 5, value: d.ratio * 100, format: (v) => `${v}%` }),
    jitter: ui.toggle({ label: "Full jitter on the backoff wait", checked: d.jitter }),
  };

  function draw() {
    const o = {
      tries: Number(get.tries.value), rej: Number(get.rej.value), cap: Number(get.cap.value),
      base: Number(get.base.value), ratio: Number(get.ratio.value) / 100, jitter: get.jitter.checked,
    };
    const r = policies(o);
    const pct = Math.round(o.ratio * 100);
    const rows = [
      ["No retry", r.none],
      ["Immediate retry", r.immediate],
      [o.jitter ? "Backoff + jitter" : "Backoff, no jitter", r.backoff],
      [`Budget ${pct}%`, r.budget],
    ];
    const px = SCALE_PX / Math.max(SCALE_AT, ...rows.map(([, v]) => v.offered));
    const shapes = [label(X, 28, `Requests per second during the fault (backend capacity ${thousands(o.cap)})`, { size: 15, weight: "bold" })];
    rows.forEach(([name, v], i) => {
      const y = 72 * i;
      const ow = v.offered * px, gw = v.goodput * px;
      shapes.push(label(X, 66 + y, name, { size: 15, weight: "bold" }));
      shapes.push(svgEl("rect", { x: X, y: 72 + y, width: ow, height: 16, rx: 3, fill: "var(--muted)", stroke: "var(--muted)", "stroke-width": 1.5, "fill-opacity": 0.25 }));
      shapes.push(label(X + ow + 8, 85 + y, `offered ${thousands(v.offered)}`, { fill: "var(--muted)" }));
      shapes.push(svgEl("rect", { x: X, y: 92 + y, width: gw, height: 16, rx: 3, fill: "var(--c2)", stroke: "var(--c2)", "stroke-width": 1.5, "fill-opacity": 0.5 }));
      shapes.push(label(X + gw + 8, 105 + y, `goodput ${thousands(v.goodput)}`, { size: 14, weight: "bold" }));
    });
    redraw(svg, shapes);
    const [result, explanation] = sentence(o, r);
    ui.say(result, explanation);
  }
  ui.start();
}

// The lecture's table of goodput by rejection cost (Deep, section 1): none, immediate, budget.
const TABLE = { 0: [501, 497, 502], 0.3: [327, 0, 290] };

/** The result in a sentence or two, and what is behind it. */
function sentence(o, r) {
  const n = thousands;
  const x = (v) => (v.offered / NEW).toFixed(1);
  const waits = Array.from({ length: Math.min(o.tries, 3) }, (_, a) => Math.min(10, o.base * 2 ** a));
  const pct = Math.round(o.ratio * 100);
  const result = o.tries === 0
    ? `With no retries, every policy offers ${NEW} requests per second and goodput is ${n(r.none.goodput)}.`
    : `Immediate retry turns ${NEW} new requests per second into ${n(r.immediate.offered)} offered, and goodput ${r.immediate.goodput < r.none.goodput ? "falls" : "stays"} from ${n(r.none.goodput)} to ${n(r.immediate.goodput)}. ` +
      `A ${pct}% retry budget gives ${n(r.budget.goodput)}.`;
  const out = [
    `${NEW} new requests per second arrive. For ${FAULT} seconds the backend can do ${n(o.cap)} per second, and rejecting a request costs it ${o.rej} of serving one.`,
    `No retry: ${n(r.none.offered)} offered, goodput ${n(r.none.goodput)}.`,
    `Immediate retry, up to ${o.tries} more ${o.tries === 1 ? "attempt" : "attempts"}: ${n(r.immediate.offered)} offered (${x(r.immediate)} times the traffic), goodput ${n(r.immediate.goodput)}, ${r.immediate.goodput < r.none.goodput ? `${n(r.none.goodput - r.immediate.goodput)} below no retry` : "not below no retry"}.`,
  ];
  const same = Math.abs(r.backoff.offered - r.immediate.offered) <= 0.005 * r.immediate.offered;
  out.push(
    `${o.jitter ? "Backoff with full jitter" : "Backoff without jitter (not worked in the lecture)"}: ${n(r.backoff.offered)} offered, goodput ${n(r.backoff.goodput)}` +
      (o.tries === 0 ? "." : same
        ? `. That is the same load as immediate retry: while the backend stays overloaded, backoff moves retries in time but sends as many.`
        : `, ${r.backoff.offered < r.immediate.offered ? "less" : "more"} offered than immediate retry because the waits, up to ${waits.map((w) => `${+w.toFixed(2)} s`).join(", ")}, keep the first seconds of the fault from reaching the steady state.`),
  );
  out.push(`A retry budget of ${pct}%: ${n(r.budget.offered)} offered (${x(r.budget)} times), goodput ${n(r.budget.goodput)}.`);
  const flat = spread({ jitter: false }), spreadOut = spread({ jitter: true });
  out.push(
    `What jitter changes, in the lecture's separate test of 1,000 clients that fail at the same moment and retry 4 times with a base of 1 second: the busiest 100 ms carries ${n(flat.peak)} retries without jitter and about ${n(spreadOut.peak)} with full jitter, spread over about ${spreadOut.buckets} buckets. The lecture reports 151 over 136 from one run. Both send 4,000 retries.`,
  );
  const others = Object.keys(DEFAULTS).every((k) => k === "rej" || o[k] === DEFAULTS[k]);
  const note =
    "These are expected values of the lecture's model: it follows the probability of each rejected request instead of drawing random numbers, and averages seconds 10 to 30 of the fault. " +
    "The lecture prints its code and one seeded run of it (seed=1), averaged over seconds 25 to 45 of a 120-second run, and another seed moves each figure by a few requests per second.";
  if (others && o.rej === DEFAULTS.rej) {
    out.push(
      `${note} That run printed 900 offered and 456 goodput for no retry, 3,312 and 182 for immediate retry, 3,307 and 187 for backoff with jitter, and 990 and 445 for the budget. The lecture's own expected-value solution, with no random draws, gives about 3,303 offered and 189 goodput for immediate retry, which is what this diagram shows.`,
    );
  } else if (others && TABLE[o.rej]) {
    const [a, b, c] = TABLE[o.rej];
    out.push(
      `${note} For a rejection cost of ${o.rej} the lecture's table lists goodput ${a} with no retry, ${b} with immediate retry and ${c} with a budget, each from one seeded run.`,
    );
  } else out.push(`${note} The lecture does not work this setting.`);
  return [result, out];
}

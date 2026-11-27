// Agent Systems, lecture 6: pass@k and pass^k. Two sources of the curves, both
// from the lecture. (1) One per-trial success rate p with independent trials:
// pass^k = p^k and pass@k = 1 - (1 - p)^k (section 4). (2) The worked example's
// ten tasks, scored with the lecture's own estimators `pass_hat_k` and
// `pass_at_k` (Deep, section 1), translated line for line.
import { label, panel, redraw, svgEl } from "./controls.js";

export const COUNTS = [10, 10, 10, 9, 8, 6, 5, 3, 1, 0];
export const N = 10;
export const K_MAX = 10;

const comb = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

/** The lecture's pass_hat_k: chance that all k trials pass, averaged over tasks. */
export const passHatK = (counts, n, k) => mean(counts.map((c) => comb(c, k) / comb(n, k)));
/** The lecture's pass_at_k: chance that at least one of k trials passes, averaged over tasks. */
export const passAtK = (counts, n, k) => 1 - mean(counts.map((c) => comb(n - c, k) / comb(n, k)));

/** pass@k and pass^k for k = 1..kMax. source is "rate" (independent trials at p) or "tasks". */
export function curves(source, p, kMax = K_MAX) {
  const rows = [];
  for (let k = 1; k <= kMax; k++) {
    rows.push(source === "tasks"
      ? { k, at: passAtK(COUNTS, N, k), hat: passHatK(COUNTS, N, k) }
      : { k, at: 1 - (1 - p) ** k, hat: p ** k });
  }
  return rows;
}

const X0 = 70, X1 = 690, Y0 = 260, TOP = 30;
const x = (k) => X0 + ((X1 - X0) * (k - 1)) / (K_MAX - 1);
const y = (v) => Y0 - v * (Y0 - TOP);
const pct = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const fix = (n) => n.toFixed(1);

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const get = {
    source: ui.choice({
      label: "Rate comes from",
      options: [["rate", "One rate p, independent trials"], ["tasks", "Worked example: ten tasks"]],
      value: "rate",
    }),
    p: ui.slider({ label: "Per-trial success p", min: 0, max: 100, value: 75, format: (v) => `${v}%` }),
    k: ui.slider({ label: "Trials k", min: 1, max: K_MAX, value: 3 }),
  };

  function draw() {
    const source = get.source.value, k = Number(get.k.value), p = Number(get.p.value) / 100;
    const tasks = source === "tasks";
    get.p.disabled = tasks;
    const rows = curves(source, p);
    const initial = !tasks && p === 0.75 && k === 3;
    const shapes = [svgEl("line", { x1: X0, y1: Y0, x2: X1, y2: Y0, stroke: "var(--border)", "stroke-width": 1 })];
    shapes.push(label(62, Y0 + 5, "0%", { anchor: "end" }));
    for (let g = 25; g <= 100; g += 25) {
      shapes.push(svgEl("line", { x1: X0, y1: y(g / 100), x2: X1, y2: y(g / 100), stroke: "var(--border)", "stroke-width": 1, "stroke-dasharray": "6 4" }));
      shapes.push(label(62, y(g / 100) + 5, `${g}%`, { anchor: "end" }));
    }
    for (let t = 1; t <= K_MAX; t++) shapes.push(label(x(t), 282, String(t), { anchor: "middle" }));
    shapes.push(label(380, 304, "k = number of trials", { size: 14, anchor: "middle" }));

    const path = (key, dash) => {
      const attrs = { d: rows.map((r, i) => `${i ? "L" : "M"}${fix(x(r.k))},${fix(y(r[key]))}`).join(" "), fill: "none", stroke: "var(--c3)", "stroke-width": 3 };
      if (dash) attrs["stroke-dasharray"] = "6 4";
      return svgEl("path", attrs);
    };
    shapes.push(path("at", false), path("hat", true));
    for (const r of rows) shapes.push(svgEl("circle", { cx: fix(x(r.k)), cy: fix(y(r.at)), r: 4, fill: "var(--c3)" }));
    for (const r of rows) shapes.push(svgEl("circle", { cx: fix(x(r.k)), cy: fix(y(r.hat)), r: 4, fill: "var(--surface)", stroke: "var(--c3)", "stroke-width": 2 }));

    const here = rows[k - 1], last = rows[K_MAX - 1];
    const below = y(here.hat) + 30 <= 252;
    const hereAt = below ? y(here.hat) + 30 : y(here.hat) - 12;

    // Curve names sit between the curves: pass@k under its curve, pass^k over its own.
    const flat = rows.every((r) => Math.abs(r.at - r.hat) < 1e-9);
    if (flat) {
      shapes.push(label(x(4), Math.max(y(rows[3].at) - 14, 20), "pass@k and pass^k are the same line here", { size: 14 }));
    } else {
      const atAt = y(rows[3].at) + 23.1;
      let hatAt = y(rows[4].hat) - 30.5;
      if (!below && k >= 5 && k <= 8) hatAt = Math.min(hatAt, hereAt - 24);
      const crowded = hatAt - atAt < 22;
      shapes.push(label(x(4), crowded ? Math.max(y(rows[3].at) - 12, 20) : atAt, "pass@k: at least one of k succeeds", { size: 14 }));
      shapes.push(label(x(5) + 20, hatAt, "pass^k: all k succeed", { size: 14 }));
    }

    if (k !== K_MAX) shapes.push(label(x(K_MAX), y(last.hat) - 12, pct(last.hat), { anchor: "middle" }));
    shapes.push(label(k >= 9 ? x(k) + 4 : x(k) - 4, hereAt, `${pct(here.hat)} at k=${k}`, { anchor: k >= 9 ? "end" : "middle" }));
    if (!initial) {
      shapes.push(svgEl("line", { x1: x(k), y1: y(1), x2: x(k), y2: Y0, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3" }));
      if (Math.abs(here.at - here.hat) > 1e-9) {
        shapes.push(label(k >= 9 ? x(k) + 4 : x(k) + 8, y(here.at) - 10, `${pct(here.at)} at k=${k}`, { anchor: k >= 9 ? "end" : "start" }));
      }
    }
    redraw(svg, shapes);

    const at1 = rows[0].at, trials = `${k} trial${k === 1 ? "" : "s"}`;
    if (tasks) {
      ui.say(
        `In the lecture's ten tasks, at least one of ${trials} passes ${pct(here.at, 1)} of the time, and all ${k} pass ${pct(here.hat, 1)} of the time.`,
        [
          `The ten tasks have ten trials each, with passes per task ${COUNTS.join(", ")}, scored with the lecture's own estimators. pass@1 is ${pct(at1, 1)}, and at k = 10 pass^10 is ${pct(last.hat, 1)}. The per-trial slider is not used here.`,
          `For comparison, independent trials at p = ${pct(at1, 0)} would give pass^${k} = ${pct(at1 ** k, 1)}. The lecture does not work that case.`,
        ],
      );
    } else {
      ui.say(
        `With a ${pct(p)} success rate per trial, at least one of ${trials} succeeds ${pct(here.at, 1)} of the time, and all ${k} succeed ${pct(here.hat, 1)} of the time.`,
        [
          `The trials are independent, so pass@${k} = 1 − (1 − p)^${k} = ${pct(here.at, 1)} (at least one succeeds) and pass^${k} = p^${k} = ${pct(here.hat, 1)} (all succeed). At k = 1 both equal p = ${pct(p, 1)}.`,
          `At k = 10: pass@10 = ${pct(last.at, 1)} and pass^10 = ${pct(last.hat, 1)}.`,
        ],
      );
    }
  }
  ui.start();
}

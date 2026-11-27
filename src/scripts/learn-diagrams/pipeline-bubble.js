// Training and fine-tuning, lecture 3: the pipeline bubble. The schedule is the
// lecture's: p stages, m micro-batches, forward 1 unit and backward 2 units per
// micro-batch, all forwards then all backwards. Its step lasts (1 + 2)(m + p - 1)
// units, each stage works 3m of them, so the idle fraction is (p - 1) / (m + p - 1).
import { label, panel, redraw, svgEl } from "./controls.js";

export const FORWARD = 1, BACKWARD = 2;
export const DEFAULTS = { stages: 4, micro: 4 };

/** Every block of the schedule, the idle gaps of each stage, and the totals. */
export function schedule(p, m) {
  const blocks = [];
  const phase = (m + p - 1) * FORWARD;
  for (let s = 0; s < p; s++) {
    for (let i = 0; i < m; i++) {
      blocks.push({ stage: s, micro: i + 1, kind: "forward", start: (s + i) * FORWARD, length: FORWARD });
      blocks.push({ stage: s, micro: i + 1, kind: "backward", start: phase + (p - 1 - s + i) * BACKWARD, length: BACKWARD });
    }
  }
  const total = (m + p - 1) * (FORWARD + BACKWARD);
  const work = m * (FORWARD + BACKWARD);
  const gaps = [];
  for (let s = 0; s < p; s++) {
    let at = 0;
    for (const b of blocks.filter((x) => x.stage === s).sort((x, y) => x.start - y.start)) {
      if (b.start > at) gaps.push({ stage: s, start: at, length: b.start - at });
      at = b.start + b.length;
    }
    if (at < total) gaps.push({ stage: s, start: at, length: total - at });
  }
  return { blocks, gaps, total, work, idle: total - work, fraction: (total - work) / total };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

const X = 96, WIDTH = 594, TOP = 44;

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const stages = ui.slider({ label: "Pipeline stages p", min: 1, max: 16, value: DEFAULTS.stages });
  const micro = ui.slider({ label: "Micro-batches m", min: 1, max: 64, value: DEFAULTS.micro });
  const shade = ui.toggle({ label: "Shade the idle time (the bubble)" });

  function draw() {
    const p = Number(stages.value), m = Number(micro.value);
    const r = schedule(p, m);
    const unit = WIDTH / r.total;
    const pitch = Math.min(44, 352 / p), h = pitch - 6;
    const pad = unit >= 8 ? 1 : unit * 0.1;
    const stroke = unit >= 8 ? 1.5 : 0.75;
    const top = (s) => TOP + pitch * s;
    const bottom = top(p - 1) + h;
    const rowFont = pitch >= 34 ? 15 : 12, cellFont = h >= 30 ? 14 : 11;
    const shapes = [];
    for (let s = 0; s < p; s++) {
      shapes.push(label(20, Math.round(top(s) + h / 2 + rowFont * 0.5), `stage ${s + 1}`, { size: rowFont }));
      shapes.push(svgEl("rect", { x: X, y: top(s), width: WIDTH, height: h, rx: 3, fill: "var(--border)", "fill-opacity": 0, stroke: "var(--border)", "stroke-width": 1 }));
    }
    if (shade.checked) {
      for (const g of r.gaps) {
        shapes.push(svgEl("rect", { x: X + g.start * unit, y: top(g.stage) + 1, width: g.length * unit, height: h - 2, fill: "var(--accent)", "fill-opacity": 0.3 }));
      }
    }
    const order = [...r.blocks].sort((a, b) => (a.kind === b.kind ? a.micro - b.micro || a.stage - b.stage : a.kind === "forward" ? -1 : 1));
    for (const b of order) {
      const fill = b.kind === "forward" ? "var(--c1)" : "var(--c3)";
      const w = b.length * unit - 2 * pad, x = X + b.start * unit + pad;
      shapes.push(svgEl("rect", { x, y: top(b.stage) + 1, width: w, height: h - 2, rx: 3, fill, "fill-opacity": 0.45, stroke: fill, "stroke-width": stroke }));
      if (w >= 18) shapes.push(label(x + w / 2, top(b.stage) + 1 + (h - 2) / 2 + cellFont * 0.5, b.micro, { size: cellFont, anchor: "middle" }));
    }
    shapes.push(label(X, 30, "time →", { size: 14, fill: "var(--muted)" }));
    // The static caption names the hues "blue" and "green"; the theme draws these two colors differently, so the legend shows the swatches.
    for (const [x, fill, text] of [[150, "var(--c1)", `forward (${FORWARD} unit)`], [330, "var(--c3)", `backward (${BACKWARD} units)`]]) {
      shapes.push(svgEl("rect", { x, y: bottom + 9, width: 16, height: 16, rx: 3, fill, "fill-opacity": 0.45, stroke: fill, "stroke-width": 1.5 }));
      shapes.push(label(x + 22, bottom + 22, text, { size: 14, fill: "var(--muted)" }));
    }
    shapes.push(label(540, bottom + 22, `${shade.checked ? "shaded" : "empty"}: bubble`, { size: 14, fill: "var(--muted)" }));
    const percent = Math.round(r.fraction * 100);
    const d = gcd(r.idle, r.total);
    const share = r.idle ? `${r.idle / d}/${r.total / d} = ${percent}%` : "0%";
    shapes.push(label(360, bottom + 50, `${r.total} units elapse; each stage works ${r.work}; idle = ${share} = (p−1)/(m+p−1)`, { size: 15, anchor: "middle" }));
    svg.setAttribute("viewBox", `0 0 720 ${bottom + 86}`);
    redraw(svg, shapes);

    ui.say(
      r.idle
        ? `With ${p} pipeline ${p === 1 ? "stage" : "stages"} and ${m} ${m === 1 ? "micro-batch" : "micro-batches"}, each stage sits idle for ${share} of the step.`
        : `With 1 pipeline stage nothing waits, so the idle share is 0%.`,
      [
        `The lecture's costs are ${FORWARD} unit forward and ${BACKWARD} units backward per micro-batch. With ${p} ${p === 1 ? "stage" : "stages"} and ${m} ${m === 1 ? "micro-batch" : "micro-batches"} the step takes ${r.total} units, and each stage works ${r.work} of them.`,
        r.idle
          ? `The idle share is (p−1)/(m+p−1) = ${p - 1}/${m + p - 1}. Compared with the useful time it is (p−1)/m = ${((p - 1) / m).toFixed(2)}.`
          : `The idle share is (p−1)/(m+p−1) = 0.`,
        "This is the lecture's schedule, which flushes at the end of the step, with equal stages. Real stages are not equal, so the true idle share is larger.",
      ],
    );
  }
  ui.start();
}

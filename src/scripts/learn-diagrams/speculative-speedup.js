// Inference and Serving, lecture 6: speculative decoding against batch size.
// `plain`, `spec` and `tokensPerRound` are the lecture's own cost model (Deep,
// section 5), line for line. It is the lecture writer's model, not a
// measurement: it leaves out cache reads. The curve is rebuilt from it.
import { label, panel, redraw, svgEl, thousands } from "./controls.js";

export const MS_TOK = 16 / 300; // ms of arithmetic per token for the 8B target
export const DEFAULTS = { alpha: 0.8, gamma: 4, batch: 94 };

/** Expected tokens per request per round; a capped geometric sum (all accepted when alpha is 1). */
export const tokensPerRound = (alpha, gamma) =>
  alpha >= 1 ? gamma + 1 : (1 - alpha ** (gamma + 1)) / (1 - alpha);

/** Tokens per second with no speculation. */
export const plain = (B) => (B / Math.max(8.0, B * MS_TOK)) * 1e3;

/** Tokens per second with speculation. */
export function spec(B, alpha, gamma) {
  const draft = gamma * Math.max(0.5, (B * MS_TOK) / 16); // 0.5 ms read, a sixteenth of the arithmetic
  const verify = Math.max(8.0, B * (gamma + 1) * MS_TOK); // gamma + 1 tokens per request
  return ((B * tokensPerRound(alpha, gamma)) / (draft + verify)) * 1e3;
}

export const ratio = (B, alpha, gamma) => spec(B, alpha, gamma) / plain(B);

/** The first batch size where speculation is slower than plain decoding (the lecture searches 1 to 399). */
export function firstLoss(alpha, gamma) {
  for (let B = 1; B < 400; B++) if (spec(B, alpha, gamma) < plain(B)) return B;
  return null;
}

const X0 = 80, X1 = 690, Y0 = 250, Y1 = 24, MAX_BATCH = 200;
const xOf = (B) => X0 + ((X1 - X0) * B) / MAX_BATCH;
const fg = { stroke: "var(--fg)", "stroke-width": 1.5 };

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const d = DEFAULTS;
  const ui = panel(svg, draw);
  const get = {
    alpha: ui.slider({ label: "Acceptance rate", min: 0.1, max: 0.95, step: 0.05, value: d.alpha, format: (v) => v.toFixed(2) }),
    gamma: ui.slider({ label: "Proposals per round", min: 1, max: 10, value: d.gamma }),
    batch: ui.slider({ label: "Batch size marked", min: 1, max: MAX_BATCH, value: d.batch }),
  };

  function draw() {
    const alpha = Math.round(Number(get.alpha.value) * 100) / 100;
    const gamma = Number(get.gamma.value);
    const batch = Number(get.batch.value);
    const ratios = [];
    for (let B = 1; B <= MAX_BATCH; B++) ratios.push(ratio(B, alpha, gamma));
    const ymax = Math.max(3, Math.ceil(Math.max(...ratios)));
    const yOf = (r) => Y0 - ((Y0 - Y1) * r) / ymax;
    const yOne = yOf(1);
    const shapes = [];
    const line = (x1, y1, x2, y2, extra = fg) => shapes.push(svgEl("line", { x1, y1, x2, y2, ...extra }));

    line(X0, Y0, X1, Y0);
    line(X0, Y1, X0, Y0);
    for (let B = 0; B <= MAX_BATCH; B += 50) {
      line(xOf(B).toFixed(1), Y0, xOf(B).toFixed(1), Y0 + 5);
      shapes.push(label(xOf(B).toFixed(1), 272, B, { anchor: "middle" }));
    }
    for (let r = 0; r <= ymax; r++) {
      line(75, yOf(r), X0, yOf(r));
      shapes.push(label(71, yOf(r) + 5, r, { anchor: "end" }));
    }
    shapes.push(label(385, 296, "Requests decoding together (batch size)", { size: 14, anchor: "middle" }));
    shapes.push(label(30, (Y0 + Y1) / 2, "ratio", { size: 14, anchor: "middle" }));
    line(X0, yOne, X1, yOne, { stroke: "var(--muted)", "stroke-width": 1.5, "stroke-dasharray": "5 4" });
    shapes.push(label(690, yOne - 6, "break-even: ratio 1", { anchor: "end", fill: "var(--muted)" }));
    const points = ratios.map((r, i) => `${i ? "L" : "M"}${xOf(i + 1).toFixed(1)} ${yOf(r).toFixed(1)}`);
    shapes.push(svgEl("path", { d: points.join(" "), fill: "none", stroke: "var(--c5)", "stroke-width": 3.5 }));

    // Each label takes the first spot where it sits on no other label, marker,
    // the break-even line, an axis or the curve. A box is [left, top, right, bottom].
    const boxes = [[565, yOne - 18, 690, yOne - 2]];
    const rounded = (r) => Math.round(r * 100) / 100;
    const boxOf = (text, x, y, anchor, weight) => {
      const width = text.length * (weight ? 7.4 : 6.6);
      const left = anchor === "end" ? x - width : x;
      return [left, y - 12, left + width, y + 4];
    };
    const clear = (b) =>
      b[0] >= X0 + 2 && b[2] <= 716 && b[1] >= 2 && b[3] <= Y0 - 3 &&
      (b[3] + 2 < yOne || b[1] - 2 > yOne) &&
      boxes.every((o) => b[0] > o[2] || b[2] < o[0] || b[1] > o[3] || b[3] < o[1]) &&
      !ratios.some((r, i) => xOf(i + 1) >= b[0] - 2 && xOf(i + 1) <= b[2] + 2 && yOf(r) >= b[1] - 2 && yOf(r) <= b[3] + 2);
    const place = (text, spots, weight) => {
      const spot = spots.find(([sx, sy, sa]) => clear(boxOf(text, sx, sy, sa, weight))) ?? spots[0];
      const [x, y, anchor] = spot;
      shapes.push(label(x.toFixed(1), y.toFixed(1), text, { anchor, weight }));
      boxes.push(boxOf(text, x, y, anchor, weight));
    };
    const start = (x, ys) => ys.map((y) => [x, y, "start"]);
    const r1 = rounded(ratios[0]), yc1 = yOf(r1);
    place(`${r1.toFixed(2)}x at small batch`, start(xOf(8), [yc1 - 10, yc1 + 24, yc1 - 28]));
    const last = rounded(ratios[MAX_BATCH - 1]), yc3 = yOf(last);
    place(`${last.toFixed(2)}x once the GPU is already busy`, start(xOf(110), [yc3 + 30, yc3 - 10, yc3 + 18, yc3 - 28, yc3 - 46]));
    const first = firstLoss(alpha, gamma);
    if (first !== null && first <= MAX_BATCH && first !== batch) {
      const fx = xOf(first);
      shapes.push(svgEl("circle", { cx: fx.toFixed(1), cy: yOne.toFixed(1), r: 5, fill: "var(--surface)", stroke: "var(--accent)", "stroke-width": 2.5 }));
      boxes.push([fx - 6, yOne - 6, fx + 6, yOne + 6]);
      place(`loses from batch ${first}`, [[fx - 10, yOne + 20, "end"], [fx - 10, yOne + 38, "end"], [fx + 10, yOne + 38, "start"]]);
    }
    const cx = xOf(batch), cy = yOf(ratios[batch - 1]);
    shapes.push(svgEl("circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 5, fill: "var(--accent)", stroke: "var(--fg)" }));
    boxes.push([cx - 6, cy - 6, cx + 6, cy + 6]);
    const beside = [-8, 20, -26, 38].flatMap((dy) => [[cx + 12, cy + dy, "start"], [cx - 12, cy + dy, "end"]]);
    place(`batch ${batch}`, beside, "bold");
    redraw(svg, shapes);

    const p = plain(batch), s = spec(batch, alpha, gamma);
    const r = s / p;
    ui.say(
      `At batch ${batch}, plain decoding delivers ${thousands(p)} tokens per second and speculation ${thousands(s)}, a ratio of ${r.toFixed(2)}: ` +
        `${r >= 1 ? "speculation is faster" : "speculation is slower than plain decoding"}. ` +
        `With acceptance ${alpha.toFixed(2)} and ${gamma} proposal${gamma === 1 ? "" : "s"}, a round yields ${tokensPerRound(alpha, gamma).toFixed(2)} tokens per request; the ratio is ${ratios[0].toFixed(2)} at batch 1 and ${ratios[MAX_BATCH - 1].toFixed(2)} at batch ${MAX_BATCH}. ` +
        `${first === null ? "In this model speculation never falls below plain decoding up to batch 399." : `In this model speculation first loses at batch ${first}.`} ` +
        `This is the lecture writer's own cost model, not a measurement: each pass takes the larger of the weight-read time (8 ms for the target, 0.5 ms for the draft) and the arithmetic time (0.0533 ms per token for the target, a sixteenth of that for the draft), every request has the same acceptance rate at every batch size, and cache reads are left out.`,
    );
  }
  ui.start();
}

// Inference and Serving, lecture 3: the token budget (Worked example, Part B).
// A pass takes the larger of an 8 ms weight read and 0.0533 ms per token
// (Lecture 1's model, as in the lecture's simulator). Decodes go first: each of
// the decoding users takes one token of the budget, and the rest is the prompt
// chunk. The picture is rebuilt from `chunked`.
import { label, panel, redraw, svgEl, thousands } from "./controls.js";

export const MS_TOK = (16e9 / 300e12) * 1e3;
export const READ_MS = 8;
export const DEFAULTS = { prompt: 6000, decoders: 40, budgetA: 2048, budgetB: 512 };

const passMs = (tokens) => Math.max(READ_MS, tokens * MS_TOK);

/** Passes needed to prefill `prompt` tokens next to `decoders` decode tokens under `budget`. */
export function chunked({ prompt, decoders, budget }) {
  const room = budget - decoders;
  if (room < 1) throw new RangeError("the decodes alone fill the budget");
  const chunk = Math.min(room, prompt);
  const passes = Math.ceil(prompt / chunk);
  const times = [];
  let left = prompt;
  for (let i = 0; i < passes; i++) {
    const take = Math.min(chunk, left);
    left -= take;
    times.push(passMs(take + decoders));
  }
  // The wait between tokens is the longest pass; the prompt is done when the last ends.
  return { chunk, passes, times, stall: Math.max(...times), total: times.reduce((a, b) => a + b, 0) };
}

/** The whole prompt in one pass. */
export const whole = ({ prompt, decoders }) => chunked({ prompt, decoders, budget: prompt + decoders });

const X = 20, BAR = 34, GAP = 1.5;
const tenth = (ms) => Math.round(ms * 10) / 10;
const ms = (t) => `${Math.round(t)} ms`;
const times = (x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1));

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const d = DEFAULTS;
  const ui = panel(svg, draw);
  const get = {
    prompt: ui.slider({ label: "Prompt tokens", min: 500, max: 10000, step: 100, value: d.prompt, format: thousands }),
    decoders: ui.slider({ label: "Users decoding", min: 1, max: 100, value: d.decoders }),
    a: ui.slider({ label: "Token budget, row 2", min: 256, max: 8192, step: 64, value: d.budgetA, format: thousands }),
    b: ui.slider({ label: "Token budget, row 3", min: 256, max: 8192, step: 64, value: d.budgetB, format: thousands }),
  };

  function draw() {
    const n = (key) => Number(get[key].value);
    const prompt = n("prompt"), decoders = n("decoders");
    const rows = [
      { whole: true, plan: whole({ prompt, decoders }) },
      { budget: n("a"), plan: chunked({ prompt, decoders, budget: n("a") }) },
      { budget: n("b"), plan: chunked({ prompt, decoders, budget: n("b") }) },
    ];
    // Same pixels per millisecond in every row; the longest row ends at x = 700.
    const longest = Math.max(...rows.map((r) => r.plan.times.reduce((a, t) => a + tenth(t), 0)));
    const scale = 680 / Math.max(350, Math.ceil(longest / 10) * 10);
    const sliver = Math.max(2, (4 * decoders) / 40);

    const shapes = [];
    rows.forEach((row, k) => {
      const y = 50 + 80 * k;
      const { plan } = row;
      const count = plan.passes;
      const title = row.whole
        ? `Whole prompt: one ${thousands(prompt + decoders)}-token pass`
        : `Budget ${thousands(row.budget)}: ${count} pass${count === 1 ? "" : "es"}`;
      shapes.push(label(20, y - 8, title, { size: 14, weight: "bold" }));
      shapes.push(label(700, y - 8, count === 1 ? `decoding users wait ${ms(plan.stall)}` : `wait ${ms(plan.stall)} between tokens`, { anchor: "end", fill: "var(--muted)" }));
      let x = X;
      for (const t of plan.times) {
        const pitch = tenth(t) * scale;
        const width = pitch - GAP;
        shapes.push(svgEl("rect", { x: x.toFixed(2), y, width: width.toFixed(2), height: BAR, rx: 2, fill: "var(--c1)", "fill-opacity": 0.45, stroke: "var(--c1)", "stroke-width": 1.5 }));
        shapes.push(svgEl("rect", { x: x.toFixed(2), y, width: Math.min(sliver, width).toFixed(2), height: BAR, fill: "var(--c2)", "fill-opacity": 0.9 }));
        shapes.push(svgEl("path", { d: `M${(x + width).toFixed(1)} ${y + BAR} v10`, stroke: "var(--accent)", "stroke-width": 2.5 }));
        x += pitch;
      }
    });
    shapes.push(svgEl("path", { d: "M20 268 v10", stroke: "var(--accent)", "stroke-width": 2.5 }));
    shapes.push(label(32, 278, "a token reaches the decoding users"));
    shapes.push(svgEl("rect", { x: 300, y: 268, width: 12, height: 12, fill: "var(--c2)", "fill-opacity": 0.9 }));
    shapes.push(label(318, 278, `their ${decoders} tokens`));
    shapes.push(svgEl("rect", { x: 430, y: 268, width: 12, height: 12, rx: 0, fill: "var(--c1)", "fill-opacity": 0.45, stroke: "var(--c1)", "stroke-width": 1.5 }));
    shapes.push(label(448, 278, "a chunk of the long prompt"));
    redraw(svg, shapes);

    const one = rows[0].plan;
    const parts = rows.slice(1).map((row) => {
      const p = row.plan;
      if (p.passes === 1) return `Budget ${thousands(row.budget)} holds the whole prompt, so it is one pass like the first row.`;
      const later = Math.round((p.total / one.total - 1) * 100);
      return `Budget ${thousands(row.budget)} leaves ${thousands(p.chunk)} prompt tokens per pass after the ${decoders} decode tokens, so ${p.passes} passes of ${ms(p.stall)}: ` +
        `the wait is ${times(one.stall / p.stall)} times shorter, and the prompt is done after ${ms(p.total)}, ${later} percent later.`;
    });
    ui.say(
      `A ${thousands(prompt)}-token prompt arrives while ${decoders} users are decoding. ` +
        `As one pass it takes ${ms(one.stall)}, and the decoding users wait that long for their next token. ` +
        `${parts.join(" ")} ` +
        `Model from Lecture 1: a pass takes the larger of 8 ms and 0.0533 ms per token, with cache reads and attention arithmetic left out.`,
    );
  }
  ui.start();
}

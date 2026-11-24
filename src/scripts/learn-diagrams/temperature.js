// How Language Models Work, lecture 2, section 3 and Worked example: divide every
// logit by T, then softmax (the lecture's next_probs). The data is the lecture's
// own GPT-2 small run on `The cat sat on the`: the eight logits shown, and, for each
// T on the slider's grid, three numbers that need all 50,257 logits and so were
// recorded with the lecture's code: ln of the softmax sum, the entropy, and the size
// of the top-p 0.9 set (the lecture's sample() rule). Nothing else is invented.
import { label, panel, redraw, svgEl } from "./controls.js";

export const TOKENS = ["floor", "bed", "couch", "ground", "edge", "sofa", "back", "bench"];
// Raw logits of those tokens. Only differences matter; the level (-81) means nothing.
export const LOGITS = [-81.29174, -81.61156, -81.80923, -82.00426, -82.02725, -82.3306, -82.41428, -82.55936];
export const T_MIN = 0.1;
export const T_MAX = 2;
export const T_STEP = 0.05;
export const DEFAULTS = [0.5, 1, 1.5];

// One entry per T = 0.10, 0.15, ... 2.00.
const LOG_SUM = [-812.87053, -541.78927, -406.16261, -324.72244, -270.38246, -231.53316, -202.3681, -179.66012, -161.47192, -146.56996, -134.13136, -123.58614, -114.52699, -106.65521, -99.74692, -93.63111, -88.17508, -83.2744, -78.84581, -74.8222, -71.14889, -67.78088, -64.68078, -61.81722, -59.16372, -56.6977, -54.39978, -52.25322, -50.24348, -48.35783, -46.58511, -44.91546, -43.34015, -41.85142, -40.44232, -39.10664, -37.8388, -36.63377, -35.48699];
const ENTROPY = [0.20991, 0.54516, 0.88462, 1.18452, 1.4446, 1.6773, 1.89597, 2.11177, 2.33361, 2.56842, 2.82131, 3.09551, 3.3922, 3.71046, 4.04734, 4.39822, 4.75732, 5.11838, 5.47529, 5.82258, 6.15583, 6.47177, 6.7683, 7.04434, 7.29967, 7.53471, 7.75032, 7.94765, 8.12803, 8.29281, 8.44337, 8.58102, 8.707, 8.82245, 8.92841, 9.02584, 9.11557, 9.19838, 9.27495];
const NUCLEUS = [1, 2, 3, 3, 5, 5, 7, 8, 9, 12, 18, 25, 39, 65, 115, 195, 322, 507, 769, 1121, 1562, 2104, 2735, 3438, 4210, 5039, 5906, 6791, 7687, 8579, 9461, 10331, 11178, 11996, 12781, 13532, 14250, 14941, 15602];

/** The lecture's softmax(logits / T) for the eight shown tokens, with its recorded companions. */
export function distribution(T) {
  const i = Math.round((T - T_MIN) / T_STEP);
  if (!(i >= 0 && i < LOG_SUM.length) || Math.abs(T_MIN + i * T_STEP - T) > 1e-6) throw new RangeError(`no recorded run at T = ${T}`);
  const probs = LOGITS.map((z) => Math.exp(z / T - LOG_SUM[i]));
  return { T, probs, top: probs[0], entropy: ENTROPY[i], choices: Math.exp(ENTROPY[i]), nucleus: NUCLEUS[i], shown: probs.reduce((a, b) => a + b, 0) };
}

const PX = 250;           // where bars start
const SCALE = 430 / 0.35; // pixels per unit of probability in the lecture's diagram
const LONGEST = 404.5;    // longest bar allowed, so the percentage still fits the 720 px frame
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const mono = (node) => (node.setAttribute("font-family", MONO), node);
const fmtT = (t) => (Math.abs(t * 10 - Math.round(t * 10)) < 1e-9 ? t.toFixed(1) : t.toFixed(2));
const pct = (p) => (p > 0 && p < 0.0005 ? "<0.1%" : `${(p * 100).toFixed(1)}%`);
const count = (n) => Math.round(n).toLocaleString("en-US");
const choices = (n) => (n < 1.5 ? "≈ 1 choice" : `≈ ${count(n)} choices`);

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const names = ["top", "middle", "bottom"];
  const get = names.map((name, i) =>
    ui.slider({ label: `Temperature T, ${name} panel`, min: T_MIN, max: T_MAX, step: T_STEP, value: DEFAULTS[i], format: fmtT }));

  function draw() {
    const dists = get.map((input) => distribution(Math.round(Number(input.value) / T_STEP) * T_STEP));
    // One scale for all panels, as in the lecture, shrunk only when a bar would not fit.
    const scale = Math.min(SCALE, LONGEST / Math.max(...dists.map((d) => d.top)));
    const shapes = [];
    dists.forEach((d, panelIndex) => {
      const y0 = 22 + 134 * panelIndex;
      shapes.push(label(10, y0 + 14, `T = ${fmtT(d.T)}`, { size: 16, weight: 600 }));
      shapes.push(label(10, y0 + 36, `top token ${pct(d.top)}`, { size: 14, fill: "var(--muted)" }));
      shapes.push(label(10, y0 + 56, choices(d.choices), { size: 14, fill: "var(--muted)" }));
      d.probs.forEach((p, row) => {
        const y = y0 + 15 * row;
        const width = p * scale;
        shapes.push(svgEl("rect", { x: PX, y, width: width.toFixed(3), height: 11, rx: 2, fill: "var(--c5)", "fill-opacity": 0.6, stroke: "var(--c5)", "stroke-width": 1 }));
        shapes.push(mono(label(240, y + 10, `\u2423${TOKENS[row]}`, { anchor: "end" })));
        shapes.push(mono(label(PX + width + 6, y + 10, pct(p), { fill: "var(--muted)" })));
      });
    });
    redraw(svg, shapes);

    const lines = dists.map(
      (d) =>
        `At T = ${fmtT(d.T)}, 90% of the probability is in ${count(d.nucleus)} ${d.nucleus === 1 ? "token" : "tokens"}.`,
    );
    const wide = (d) => (d.choices < 1.5 ? "1" : count(d.choices));
    ui.say(
      `At T = ${dists.map((d) => fmtT(d.T)).join(", ")}, "floor" leads with ${dists.map((d) => pct(d.top)).join(", ")}. ` +
        `The table is as wide as ${dists.map(wide).join(", ")} equally likely choices.`,
      [
        'The data is the lecture\'s run of GPT-2 small after "The cat sat on the": every logit divided by T, then softmax.',
        `${lines.join(" ")} The eight tokens shown hold ${dists.map((d) => `${(d.shown * 100).toFixed(0)}%`).join(", ")} of the probability in the three panels, and the other tokens share the rest.`,
        scale < SCALE ? "Bars are drawn at a smaller scale so the longest fits; read the percentages." : "",
      ],
    );
  }
  ui.start();
}

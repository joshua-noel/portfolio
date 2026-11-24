// Training and fine-tuning, lecture 5: the KL leash. The model is the lecture's
// closed form for "maximize E[r] - beta * KL(pi || pi_ref)": the starting policy
// reweighted by exp(r / beta) and normalised (Waterline section 4, Deep section 2).
// The four answers, their rewards and the starting policy are the lecture's
// worked example, not measurements of a model.
import { label, panel, redraw, svgEl } from "./controls.js";

export const REWARDS = [2, 1, 0, -1];
export const REF = [0.1, 0.2, 0.3, 0.4];
/** The beta values the slider steps through; the lecture tabulates 10, 2, 0.5 and 0.1. */
export const BETAS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10, 20];
export const DEFAULTS = { beta: 0.5, lighter: 2, darker: 0.1 };
const WORKED = [10, 2, 0.5, 0.1];

/** pi*(y) = pi_ref(y) exp(r(y)/beta) / Z, with its expected reward and KL(pi* || pi_ref). */
export function policy(beta, reward = REWARDS, ref = REF) {
  const top = Math.max(...reward) / beta;
  const w = ref.map((p, i) => p * Math.exp(reward[i] / beta - top));
  const z = w.reduce((a, b) => a + b, 0);
  const p = w.map((x) => x / z);
  const expected = p.reduce((a, x, i) => a + x * reward[i], 0);
  const kl = p.reduce((a, x, i) => (x > 0 ? a + x * Math.log(x / ref[i]) : a), 0);
  return { p, expected, kl };
}

const pct = (p) => {
  const v = p * 100;
  if (v > 99.95) return "over 99.9%";
  if (v < 0.05) return "under 0.1%";
  return `${v.toFixed(1)}%`;
};
const signed = (n) => (n < 0 ? `−${-n}` : `${n}`);
const fixed2 = (n) => {
  if (Math.abs(n) < 0.0005) return "0.00";
  return (Math.abs(n) < 0.1 ? n.toFixed(3) : n.toFixed(2)).replace("-", "−");
};

const BASE = 250, SCALE = 200, W = 26;

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const pick = ui.slider({
    label: "β, the middle bars", min: 0, max: BETAS.length - 1, value: BETAS.indexOf(DEFAULTS.beta),
    format: (i) => String(BETAS[i]),
  });
  const others = ui.toggle({ label: "Also show β = 2 and β = 0.1", checked: true });

  function draw() {
    const beta = BETAS[Number(pick.value)];
    const series = [
      { beta: DEFAULTS.lighter, opacity: 0.3, on: others.checked, x: 315.04 },
      { beta, opacity: 0.6, on: true, x: 405.44 },
      { beta: DEFAULTS.darker, opacity: 0.95, on: others.checked, x: 510.4 },
    ].map((s) => ({ ...s, p: policy(s.beta).p }));
    const shapes = [svgEl("line", { x1: 70, y1: BASE, x2: 700, y2: BASE, stroke: "var(--fg)", "stroke-width": 1.5 })];
    const bar = (x, p, fill, opacity, dashed) => {
      const attrs = {
        x, y: BASE - p * SCALE, width: W, height: p * SCALE, rx: 2, fill, "fill-opacity": opacity,
        stroke: fill, "stroke-width": 1.5,
      };
      if (dashed) attrs["stroke-dasharray"] = "4 3";
      return svgEl("rect", attrs);
    };
    REWARDS.forEach((r, i) => {
      const x0 = 90 + 140 * i;
      shapes.push(bar(x0, REF[i], "var(--fg)", 0, true));
      series.forEach((s, k) => {
        if (s.on) shapes.push(bar(x0 + 28 * (k + 1), s.p[i], "var(--c2)", s.opacity));
      });
      shapes.push(label(x0 + 56, 272, `answer ${i + 1}`, { size: 14, anchor: "middle" }));
      shapes.push(label(x0 + 56, 290, `reward ${r < 0 ? "-" : "+"}${Math.abs(r)}`, { anchor: "middle", fill: "var(--muted)" }));
    });
    shapes.push(label(70, 24, "probability", { size: 14, fill: "var(--muted)" }));
    [["0", 255], ["0.5", 155], ["1.0", 55]].forEach(([text, y]) => shapes.push(label(64, y, text, { anchor: "end" })));
    const key = (x, fill, opacity, text, dashed) => {
      shapes.push(svgEl("rect", {
        x, y: 308, width: 14, height: 14, rx: 2, fill, "fill-opacity": opacity, stroke: fill, "stroke-width": 1.5,
        ...(dashed ? { "stroke-dasharray": "4 3" } : {}),
      }));
      shapes.push(label(x + 20, 320, text));
    };
    key(130, "var(--fg)", 0, "start (SFT) policy", true);
    for (const s of series) if (s.on) key(s.x, "var(--c2)", s.opacity, `β = ${s.beta}`);
    redraw(svg, shapes);

    const { p, expected, kl } = policy(beta);
    const win = p.indexOf(Math.max(...p));
    const refWin = REF.indexOf(Math.max(...REF));
    const [e0, k0] = [REF.reduce((a, x, i) => a + x * REWARDS[i], 0), 0];
    ui.say(
      `With β = ${beta}, answer ${win + 1} is the most likely, at ${pct(p[win])}${win === refWin ? ", as at the start" : ` (answer ${refWin + 1} at the start)`}. ` +
        `The expected reward is ${fixed2(expected)}, against ${fixed2(e0)} at the start.`,
      [
        `The lecture's example: four answers with rewards ${REWARDS.map(signed).join(", ")} and a starting policy of ${REF.map((x) => pct(x)).join(", ")}.`,
        `With β = ${beta}, the tuned policy is ${p.map((x, i) => `${pct(x)} on answer ${i + 1}`).join(", ")}. Its KL from the start is ${fixed2(kl)} (${fixed2(k0)} at the start).`,
        WORKED.includes(beta)
          ? "The lecture works this value of β."
          : "The lecture works β = 10, 2, 0.5 and 0.1; this value uses the same formula and is not worked there.",
        others.checked ? `The lighter and darker bars stay at β = ${DEFAULTS.lighter} and β = ${DEFAULTS.darker}.` : "",
      ],
    );
  }
  ui.start();
}

// Agent Systems, lecture 4: the budget. The sliders are the parts of the
// request from the worked example; `assemble` is the lecture's own Python
// function (Deep, section 1), line for line. The picture is rebuilt from it.
import { label, panel, redraw, svgEl, thousands } from "./controls.js";

export const PLACEHOLDER = 25;
export const DEFAULTS = {
  window: 32000, reserve: 2000, tools: 12, memory: 400, history: 9500,
  passages: 10, results: [6200, 2300, 9800], cap: 1500,
};
const SYSTEM = 800, TOOL = 220, USER = 150, PASSAGE = 700;

/** The lecture's assemble(): must and memory, passages, results newest first, then history. */
export function assemble(s) {
  const budget = s.window - s.reserve;
  const musts = SYSTEM + s.tools * TOOL + USER;
  const passages = s.passages * PASSAGE;
  const raw = musts + s.memory + s.history + passages + s.results.reduce((a, b) => a + b, 0);
  let left = budget - musts - s.memory - passages;
  const results = [];
  for (let i = s.results.length - 1; i >= 0; i--) {
    const fits = s.results[i] <= left - s.cap;
    results[i] = fits ? s.results[i] : PLACEHOLDER;
    left -= results[i];
  }
  const history = Math.min(s.history, s.cap, Math.max(left, 0));
  left -= history;
  return { budget, raw, musts, passages, results, history, total: budget - left, left };
}

const X = 40, W = 640, BAR = 46;

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const d = DEFAULTS;
  const ui = panel(svg, draw);
  const get = {
    window: ui.slider({ label: "Window", min: 8000, max: 64000, step: 1000, value: d.window, format: thousands }),
    reserve: ui.slider({ label: "Reply reserve", min: 0, max: 8000, step: 500, value: d.reserve, format: thousands }),
    tools: ui.slider({ label: "Tool definitions (× 220)", min: 0, max: 30, value: d.tools }),
    memory: ui.slider({ label: "Memory", min: 0, max: 2000, step: 50, value: d.memory, format: thousands }),
    history: ui.slider({ label: "History", min: 0, max: 20000, step: 500, value: d.history, format: thousands }),
    passages: ui.slider({ label: "Passages (× 700)", min: 0, max: 20, value: d.passages }),
    r0: ui.slider({ label: "Tool result 1, oldest", min: 0, max: 12000, step: 100, value: d.results[0], format: thousands }),
    r1: ui.slider({ label: "Tool result 2", min: 0, max: 12000, step: 100, value: d.results[1], format: thousands }),
    r2: ui.slider({ label: "Tool result 3, newest", min: 0, max: 12000, step: 100, value: d.results[2], format: thousands }),
    cap: ui.slider({ label: "History summary cap", min: 0, max: 4000, step: 100, value: d.cap, format: thousands }),
  };

  function draw() {
    const n = (key) => Number(get[key].value);
    const s = { window: n("window"), reserve: n("reserve"), tools: n("tools"), memory: n("memory"),
      history: n("history"), passages: n("passages"), results: [n("r0"), n("r1"), n("r2")], cap: n("cap") };
    const r = assemble(s);
    const scale = W / Math.max(r.raw, r.budget, 1);
    const rawResults = s.results.reduce((a, b) => a + b, 0);
    const keptResults = r.results.reduce((a, b) => a + b, 0);
    const shapes = [];
    const bar = (y, parts) => {
      let x = X;
      for (const [tokens, fill, opacity] of parts) {
        const w = tokens * scale;
        shapes.push(svgEl("rect", { x: x.toFixed(1), y, width: w.toFixed(1), height: BAR, fill, "fill-opacity": opacity }));
        x += w;
      }
      return x;
    };
    shapes.push(label(X, 52, `raw: ${thousands(r.raw)} tokens`, { size: 14, weight: 600 }));
    const rawEnd = bar(60, [[r.musts, "var(--accent)", 1], [s.memory, "var(--c5)", 1], [s.history, "var(--c4)", 1], [r.passages, "var(--c3)", 1], [rawResults, "var(--c3)", 0.55]]);
    shapes.push(label(X, 152, `assembled: ${thousands(r.total)} tokens`, { size: 14, weight: 600 }));
    const end = bar(160, [[r.musts, "var(--accent)", 1], [s.memory, "var(--c5)", 1], [r.history, "var(--c4)", 1], [r.passages, "var(--c3)", 1], [keptResults, "var(--c3)", 0.55]]);
    const line = X + r.budget * scale;
    shapes.push(svgEl("line", { x1: line, y1: 40, x2: line, y2: 230, stroke: "var(--c6)", "stroke-width": 2.5, "stroke-dasharray": "6 4" }));
    shapes.push(label(line, 252, `budget ${thousands(r.budget)}`, { anchor: "middle", fill: "var(--c6)", weight: 600 }));
    if (r.raw > r.budget) shapes.push(label(rawEnd - 2, 128, `over by ${thousands(r.raw - r.budget)}`, { anchor: "end", fill: "var(--c6)", weight: 600 }));
    if (r.left >= 0) shapes.push(label((end + line) / 2, 222, `headroom ${thousands(r.left)}`, { anchor: "middle", fill: "var(--muted)" }));
    else if (end < 560) shapes.push(label(end + 8, 188, `still over by ${thousands(-r.left)}`, { fill: "var(--c6)", weight: 600 }));
    else shapes.push(label(end - 2, 222, `still over by ${thousands(-r.left)}`, { anchor: "end", fill: "var(--c6)", weight: 600 }));
    [["var(--accent)", 1, "system, tools, user", 40], ["var(--c5)", 1, "memory", 223], ["var(--c4)", 1, "history", 315], ["var(--c3)", 1, "passages", 414], ["var(--c3)", 0.55, "tool results", 520]].forEach(([fill, opacity, text, x]) => {
      shapes.push(svgEl("rect", { x, y: 282, width: 16, height: 16, fill, "fill-opacity": opacity }));
      shapes.push(label(x + 22, 295, text));
    });
    redraw(svg, shapes);

    const cuts = [];
    if (r.history < s.history) cuts.push(`history −${thousands(s.history - r.history)} to ${thousands(r.history)}`);
    r.results.forEach((t, i) => {
      if (t !== s.results[i]) cuts.push(`tool result ${i + 1} −${thousands(s.results[i] - t)} to a ${PLACEHOLDER}-token placeholder`);
    });
    ui.say(
      `Window ${thousands(s.window)} minus a ${thousands(s.reserve)} reply reserve leaves ${thousands(r.budget)} tokens of input. ` +
        `The parts total ${thousands(r.raw)}, ${r.raw > r.budget ? `${thousands(r.raw - r.budget)} over` : "which fits"}. ` +
        `After the policy: ${thousands(r.total)} tokens, ${r.left >= 0 ? `${thousands(r.left)} to spare` : `still ${thousands(-r.left)} over, because the fixed parts and passages alone do not fit`}. ` +
        (cuts.length ? `Evicted: ${cuts.join("; ")}.` : "Nothing is evicted."),
    );
  }
  ui.start();
}

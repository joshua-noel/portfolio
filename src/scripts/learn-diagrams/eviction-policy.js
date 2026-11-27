// Agent Systems, lecture 5: the eviction timeline. `run` is the lecture's
// "Pressure" paragraph (Worked example, and Deep section 4) as a function: an
// 8,000-token window, 1,200 fixed tokens, 250-token messages, warn at 70%,
// flush above the window, a flush evicts 16 messages (4,000 tokens) and swaps
// in a 300-token summary; evicted messages stay in the recall store.
// The FIFO queue and "never evict" are comparisons the lecture does not work.
import { label, panel, redraw, svgEl, thousands } from "./controls.js";

export const PARAMS = { window: 8000, fixed: 1200, message: 250, warn: 0.7, summary: 300, evict: 16, total: 60 };
export const POLICIES = [
  ["memgpt", "MemGPT flush (the lecture's)"],
  ["fifo", "FIFO queue (comparison, not worked)"],
  ["never", "Never evict (comparison, not worked)"],
];

/**
 * Plays messages 1..last. Returns the window use after every message
 * (`points[i]` is the state after message i, with `before` the size that
 * triggered the eviction), the flush messages and where every message is now:
 * `kept` in the window, `recall` evicted but stored, `lost` dropped.
 */
export function run(policy, last, p = PARAMS) {
  const queue = [], recall = [], lost = [], flushes = [];
  let summary = false;
  const tokens = () => p.fixed + (summary ? p.summary : 0) + queue.length * p.message;
  const points = [{ n: 0, before: tokens(), after: tokens() }];
  for (let n = 1; n <= last; n++) {
    queue.push(n);
    const before = tokens();
    if (before > p.window && policy !== "never") {
      if (policy === "memgpt") {
        recall.push(...queue.splice(0, Math.min(p.evict, queue.length)));
        summary = true;
      } else {
        lost.push(...queue.splice(0, Math.ceil((before - p.window) / p.message)));
      }
      flushes.push(n);
    }
    points.push({ n, before, after: tokens() });
  }
  return { points, flushes, kept: [...queue], recall, lost, summary, tokens: tokens(), warnAt: Math.round(p.window * p.warn) };
}

const X0 = 70, X1 = 690, Y0 = 330, YTOP = 40, CHART_H = 380, STRIP_H = 470;
const joined = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : String(list[0]));

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const get = {
    policy: ui.choice({ label: "Policy", options: POLICIES, value: "memgpt" }),
    n: ui.slider({ label: "Message number", min: 0, max: PARAMS.total, value: PARAMS.total }),
    evict: ui.slider({
      label: "Messages evicted per flush", min: 4, max: 24, value: PARAMS.evict,
      format: (v) => `${v} (${thousands(v * PARAMS.message)} tokens)`,
    }),
  };
  const back = ui.button("Step back", () => (get.n.value = Math.max(0, Number(get.n.value) - 1)));
  const forward = ui.button("Step forward", () => (get.n.value = Math.min(PARAMS.total, Number(get.n.value) + 1)));

  function draw() {
    const policy = get.policy.value, n = Number(get.n.value), p = { ...PARAMS, evict: Number(get.evict.value) };
    const full = run(policy, p.total, p), now = run(policy, n, p);
    const initial = policy === "memgpt" && n === p.total && p.evict === PARAMS.evict;
    back.disabled = n <= 0;
    forward.disabled = n >= p.total;

    const peak = Math.max(...full.points.map((pt) => pt.before));
    const yMax = Math.max(9000, Math.ceil(peak / 1000) * 1000);
    const x = (i) => X0 + ((X1 - X0) * i) / p.total;
    const yOf = (t) => Y0 - (t * (Y0 - YTOP)) / yMax;
    const shapes = [
      svgEl("line", { x1: X0, y1: Y0, x2: X1, y2: Y0, stroke: "var(--border)", "stroke-width": 1.5 }),
      svgEl("line", { x1: X0, y1: Y0, x2: X0, y2: YTOP, stroke: "var(--border)", "stroke-width": 1.5 }),
    ];
    for (let t = 0; t < yMax; t += 2000) shapes.push(label(62, yOf(t) + 5, thousands(t), { anchor: "end", fill: "var(--muted)" }));
    if (policy === "memgpt") {
      shapes.push(svgEl("line", { x1: X0, y1: yOf(now.warnAt), x2: X1, y2: yOf(now.warnAt), stroke: "var(--accent)", "stroke-width": 2, "stroke-dasharray": "6 4" }));
      shapes.push(label(78, yOf(now.warnAt) - 6, `warn ${thousands(now.warnAt)} (70%)`, { fill: "var(--accent)", weight: 600 }));
    }
    shapes.push(svgEl("line", { x1: X0, y1: yOf(p.window), x2: X1, y2: yOf(p.window), stroke: "var(--c6)", "stroke-width": 2, "stroke-dasharray": "6 4" }));
    shapes.push(label(78, yOf(p.window) - 6, policy === "memgpt" ? `flush above ${thousands(p.window)}` : `window ${thousands(p.window)}`, { fill: "var(--c6)", weight: 600 }));

    const line = [];
    for (const pt of now.points) {
      line.push(`${x(pt.n).toFixed(1)},${yOf(pt.before).toFixed(1)}`);
      if (pt.after !== pt.before) line.push(`${x(pt.n).toFixed(1)},${yOf(pt.after).toFixed(1)}`);
    }
    shapes.push(svgEl("polyline", { points: line.join(" "), fill: "none", stroke: "var(--c4)", "stroke-width": 3 }));

    const marked = now.flushes.length <= 5 ? now.flushes : now.flushes.slice(0, 1);
    for (const m of marked) shapes.push(label(x(m), 350, String(m), { anchor: "middle", fill: "var(--muted)" }));
    let caption;
    if (policy === "never") caption = "message number (nothing is evicted)";
    else if (policy === "fifo") caption = now.flushes.length ? `message number (first drop at ${now.flushes[0]}, then one a message)` : "message number (nothing dropped yet)";
    else if (!now.flushes.length) caption = "message number (no flush yet)";
    else if (marked.length === now.flushes.length) caption = `message number (flush at ${now.flushes.join(", ")})`;
    else caption = `message number (first flush at ${now.flushes[0]}, ${now.flushes.length} in all)`;
    shapes.push(label(380, 374, caption, { anchor: "middle", fill: "var(--muted)" }));
    shapes.push(label(70, 28, "tokens in window", { fill: "var(--muted)" }));

    const end = now.points[now.points.length - 1];
    const over = end.after - p.window;
    if (!initial) {
      shapes.push(svgEl("line", { x1: x(n), y1: Y0, x2: x(n), y2: yOf(end.after), stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3" }));
      shapes.push(svgEl("circle", { cx: x(n).toFixed(1), cy: yOf(end.after).toFixed(1), r: 5, fill: "var(--c4)", stroke: "var(--fg)", "stroke-width": 1.5 }));
    }
    if (over > 0) shapes.push(label(Math.min(x(n), X1) - 8, yOf(end.after) - 12, `over the window by ${thousands(over)}`, { anchor: "end", fill: "var(--c6)", weight: 600 }));

    // What each message is now. Only drawn once the reader changes something, so the
    // default drawing stays the lecture's chart.
    if (!initial) {
      const header = {
        memgpt: `The lecture's policy: where each message is after message ${n}`,
        fifo: `Comparison, not worked in the lecture: plain FIFO queue, no summary, no recall store`,
        never: `Comparison, not worked in the lecture: never evict, the window only grows`,
      }[policy];
      shapes.push(label(X0, 396, header, { fill: "var(--muted)" }));
      const where = new Map();
      now.kept.forEach((m) => where.set(m, "var(--c4)"));
      now.recall.forEach((m) => where.set(m, "var(--c5)"));
      now.lost.forEach((m) => where.set(m, "var(--c6)"));
      for (let m = 1; m <= p.total; m++) {
        const fill = where.get(m);
        shapes.push(svgEl("rect", { x: (x(m) - 4.25).toFixed(1), y: 404, width: 8.5, height: 22, fill: fill ?? "none", stroke: fill ?? "var(--border)", "stroke-width": 1 }));
      }
      const legend = [["var(--c4)", "in the window"]];
      if (now.recall.length) legend.push(["var(--c5)", "in the recall store (evicted)"]);
      if (now.lost.length) legend.push(["var(--c6)", "dropped, gone"]);
      if (n < p.total) legend.push(["none", "not sent yet"]);
      let lx = X0;
      for (const [fill, text] of legend) {
        shapes.push(svgEl("rect", { x: lx, y: 440, width: 16, height: 16, fill, stroke: fill === "none" ? "var(--border)" : fill, "stroke-width": 1 }));
        shapes.push(label(lx + 22, 453, text));
        lx += 22 + text.length * 6.6 + 22;
      }
    }
    svg.setAttribute("viewBox", `0 0 720 ${initial ? CHART_H : STRIP_H}`);
    redraw(svg, shapes);

    const parts = [`${thousands(p.fixed)} fixed`];
    if (now.summary) parts.push(`a ${p.summary}-token summary`);
    parts.push(`${now.kept.length} messages × ${p.message}`);
    const name = { memgpt: "MemGPT flush (the lecture's)", fifo: "Comparison, not worked in the lecture: plain FIFO queue", never: "Comparison, not worked in the lecture: never evict" }[policy];
    const excess = now.tokens - p.window;
    let first = `After message ${n}, the window holds ${thousands(now.tokens)} of ${thousands(p.window)} tokens`;
    if (excess > 0) first += `, ${thousands(excess)} over`;
    else if (policy === "memgpt" && now.tokens > now.warnAt) first += `, above the ${thousands(now.warnAt)} warn level`;
    let second;
    if (policy === "memgpt") {
      second = `${now.flushes.length === 0 ? "No flush yet" : now.flushes.length === 1 ? "One flush so far" : `${now.flushes.length} flushes so far`}; ${now.recall.length} messages are in the recall store and none is lost.`;
    } else if (policy === "fifo") {
      second = now.lost.length ? `${now.lost.length} messages have been dropped for good.` : "Nothing has been dropped yet.";
    } else {
      second = "Nothing is evicted, so the window only grows.";
    }
    const more = [`${name}. The window holds ${parts.join(" + ")}.`];
    if (policy === "memgpt") {
      more.push(
        now.flushes.length
          ? `Flushes at message ${joined(now.flushes)}, each evicting ${p.evict} messages (${thousands(p.evict * p.message)} tokens). Evicted messages stay in the recall store, which the model has to search; they are not in the window.`
          : "No flush yet. A flush happens when the window would go over its limit.",
      );
    } else if (policy === "fifo") {
      more.push(now.lost.length ? `The oldest messages are dropped from message ${now.flushes[0]} on, and no summary is kept.` : "Once the window is full, the oldest message is dropped for each new one; no summary is kept.");
    }
    if (n < p.total) more.push(`${p.total - n} of the ${p.total} messages are not sent yet.`);
    ui.say(`${first}. ${second}`, more);
  }
  ui.start();
}

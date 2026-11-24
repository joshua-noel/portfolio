// System Design, lecture 5, section 6: which side of a partition can commit.
// The rule is the lecture's: a write counts when W replicas have it, and a
// majority is floor(N/2) + 1 (section 4). A side that holds fewer than W
// replicas cannot reach W, so it must refuse writes (section 6).
import { label, panel, redraw, svgEl } from "./controls.js";

export const DEFAULTS = { n: 3, left: 2, rule: "majority", attempts: 60 };
export const RULES = [
  ["majority", "Majority, ⌊N/2⌋ + 1"],
  ["one", "W = 1"],
  ["all", "W = N (not in the lecture)"],
];

/** The lecture's majority of N replicas. */
export const majority = (n) => Math.floor(n / 2) + 1;
/** W for a rule: how many replicas must acknowledge before a write counts. */
export const writeQuorum = (n, rule) => (rule === "one" ? 1 : rule === "all" ? n : majority(n));

/** Two sides, `left` and `n - left` replicas; a side commits when it holds at least W. */
export function partition({ n, left, rule }) {
  const w = writeQuorum(n, rule);
  const side = (size) => ({ size, commits: size >= w, isMajority: size >= majority(n) });
  const l = side(left);
  const r = side(n - left);
  return { n, w, rule, majority: majority(n), left: l, right: r, both: l.commits && r.commits, neither: !l.commits && !r.commits, cut: left > 0 && left < n };
}

/** The lecture's last-seat example: 100 attempts, `toLeft` of them reach the left side. */
export function lastSeat(p, toLeft) {
  const toRight = 100 - toLeft;
  const refused = (p.left.commits ? 0 : toLeft) + (p.right.commits ? 0 : toRight);
  return { toLeft, toRight, refused, heldTwice: p.both && toLeft > 0 && toRight > 0 };
}

const BOX_Y = 60, BOX_H = 270, ROW = 70;

/** Where the replicas of one side go: rows of at most `cols`, centred in the side's box. */
function layout(count, cols, boxX, cw) {
  const pitch = cw * 0.95, rw = cw * 0.65;
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = count <= 2 ? 0 : Math.floor(i / cols), col = count <= 2 ? i : i % cols;
    const inRow = count <= 2 ? count : Math.min(cols, count - row * cols);
    const x = boxX + (cols * cw - ((inRow - 1) * pitch + rw)) / 2 + col * pitch;
    slots.push({ x, y: 110 + row * ROW, w: rw, row });
  }
  return slots;
}

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const d = DEFAULTS;
  const ui = panel(svg, draw);
  const get = {
    rule: ui.choice({ label: "Write quorum", options: RULES, value: d.rule }),
    n: ui.slider({ label: "Replicas (N)", min: 2, max: 7, value: d.n }),
    left: ui.slider({ label: "Replicas on the left side", min: 0, max: 7, value: d.left }),
    attempts: ui.slider({ label: "Of 100 buy attempts, reaching the left side", min: 0, max: 100, step: 5, value: d.attempts }),
  };

  // The split cannot exceed N: lower the slider's own limit and show the clamped value.
  function limit(input, max) {
    input.max = max;
    if (Number(input.value) > max) input.value = max;
    input.nextElementSibling.textContent = input.value;
    input.setAttribute("aria-valuetext", input.value);
  }

  function draw() {
    const n = Number(get.n.value);
    limit(get.left, n);
    const left = Number(get.left.value);
    const p = partition({ n, left, rule: get.rule.value });
    const seat = lastSeat(p, Number(get.attempts.value));
    const shapes = [];
    const y = Math.max(left, n - left) > 2 ? 254 : 230;

    const colsOf = (c) => (c <= 2 ? Math.max(c, 1) : Math.ceil(c / 2));
    const colsL = colsOf(left), colsR = colsOf(n - left);
    const cw = Math.min(200, 600 / (colsL + colsR));
    const boxes = [
      { side: p.left, x: 20, cols: colsL, letters: 0 },
      { side: p.right, x: 700 - colsR * cw, cols: colsR, letters: left },
    ];

    boxes.forEach((b) => {
      if (!p.cut && b.side.size === 0) return; // nothing is cut: there is no second side to draw
      const tone = b.side.commits ? "var(--c2)" : "var(--c5)";
      const width = b.cols * cw;
      shapes.push(svgEl("rect", { x: b.x, y: BOX_Y, width, height: BOX_H, rx: 12, fill: tone, stroke: tone, "stroke-width": 1.5, "fill-opacity": 0.08 }));
      shapes.push(label(b.x + width / 2, 52, `${b.side.isMajority ? "Majority" : "Minority"} side: ${b.side.size} of ${n}`, { size: 15, anchor: "middle", weight: "bold" }));
      const slots = layout(b.side.size, b.cols, b.x, cw);
      slots.forEach((s, i) => {
        const name = String.fromCharCode(65 + b.letters + i);
        const leader = i === 0 && b.letters + i === 0;
        shapes.push(svgEl("rect", { x: s.x, y: s.y, width: s.w, height: 60, rx: 8, fill: "var(--c3)", stroke: "var(--c3)", "stroke-width": 1.5, "fill-opacity": 0.18 }));
        shapes.push(label(s.x + s.w / 2, leader ? s.y + 25 : s.y + 35, `Replica ${name}`, { size: 15, anchor: "middle", weight: "bold" }));
        if (leader) shapes.push(label(s.x + s.w / 2, s.y + 45, "leader", { anchor: "middle", fill: "var(--muted)" }));
      });
      if (slots.length > 1 && slots[1].row === 0) {
        shapes.push(svgEl("line", { x1: slots[0].x + slots[0].w, y1: 140, x2: slots[1].x - 2, y2: 140, stroke: "var(--fg)", "stroke-width": 2, "marker-end": "url(#ah)" }));
      }
      // The write box spans the first row of replicas, as in the static diagram.
      const first = slots[0] ?? { x: b.x + (width - cw * 0.65) / 2, w: cw * 0.65 };
      const inFirstRow = slots.filter((s) => s.row === 0);
      const last = inFirstRow[inFirstRow.length - 1] ?? first;
      const boxW = last.x + last.w - first.x;
      shapes.push(svgEl("rect", { x: first.x, y, width: boxW, height: 56, rx: 8, fill: tone, stroke: tone, "stroke-width": 1.5, "fill-opacity": 0.2 }));
      const lines = b.side.commits
        ? boxW < 200 ? ["Write accepted", `${b.side.size} of ${n} ack`] : [`Write accepted: ${b.side.size} of ${n} ack`]
        : ["Write refused"];
      lines.forEach((t, i) => shapes.push(label(first.x + boxW / 2, lines.length === 1 ? y + 33 : y + 24 + i * 18, t, { size: 14, anchor: "middle", weight: "bold" })));
    });

    const leftEnd = 20 + colsL * cw;
    const cutX = leftEnd + (700 - colsR * cw - leftEnd) / 2 - 30;
    if (p.cut) {
      shapes.push(svgEl("line", { x1: cutX, y1: 70, x2: cutX, y2: 320, stroke: "var(--c5)", "stroke-width": 4, "stroke-dasharray": "10 6" }));
      shapes.push(label(cutX + 30, 200, "cut", { size: 14, weight: "bold", fill: "var(--c5)" }));
    }
    const note = !p.cut
      ? "No partition: every replica is on one side."
      : p.both ? "Both sides accept: two histories to reconcile."
        : p.neither ? "Neither side has W replicas, so both refuse. Nothing can commit."
          : "If W = 1 instead, both sides accept: two histories to reconcile.";
    shapes.push(label(360, 365, note, { size: 14, anchor: "middle", fill: "var(--muted)" }));
    redraw(svg, shapes);

    ui.say(sentence(p, seat));
  }
  ui.start();
}

function sentence(p, seat) {
  const { n, w } = p;
  const rule = p.rule === "majority" ? `a majority quorum (W = ${w})` : `W = ${w}`;
  const side = (s, name) => {
    const kind = s.isMajority ? "a majority" : "a minority";
    return s.commits
      ? `The ${name} side has ${s.size} of ${n} replicas, ${kind}, and at least W = ${w}, so it can commit writes.`
      : `The ${name} side has ${s.size} of ${n} replicas, ${kind}, fewer than W = ${w}, so it must refuse writes.`;
  };
  const out = [`${n} replicas with ${rule}.`];
  if (!p.cut) {
    out.push(`Every replica is on one side, so there is no partition. That side holds all ${n} and commits.`);
    return out.join(" ");
  }
  out.push(side(p.left, "left"), side(p.right, "right"));
  if (p.both) out.push("Both sides accept writes, so when the link heals the system holds two conflicting histories.");
  else if (p.neither) out.push("No side can commit, so every write is refused until the link heals. This follows from the rule; the lecture works only 3 replicas split 2 and 1.");
  const refusedText = seat.refused ? `${seat.refused} of 100 last-seat attempts get a refusal` : "no last-seat attempt is refused";
  out.push(`With ${seat.toLeft} of 100 buy attempts reaching the left side and ${seat.toRight} the right: ${refusedText}${seat.heldTwice ? ", and both sides accept a hold on the same seat, so one seat is held twice" : ""}.`);
  return out.join(" ");
}

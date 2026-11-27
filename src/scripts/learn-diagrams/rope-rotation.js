// How Language Models Work, lecture 4, Waterline section 3 and Worked example,
// Part A: one pair of numbers rotated by position times 0.1 radian, both vectors
// starting as (1, 0). `ropeScore` rotates each vector as the lecture's rotate()
// does and takes the dot product. Drag a vector, or use the sliders.
import { arrowhead, label, panel, svgEl } from "./controls.js";

export const FREQ = 0.1; // radian per position, the lecture's example
export const MAX_POS = 30; // keeps both arrows in the upper half of the circle
export const DEFAULTS = { a: [5, 2], b: [10, 7] };

/** The lecture's rotate() for one pair: turn (x, y) by pos * FREQ. */
export function rotate([x, y], pos, freq = FREQ) {
  const c = Math.cos(pos * freq);
  const s = Math.sin(pos * freq);
  return [x * c - y * s, x * s + y * c];
}

/** Query at m, key at n, both starting as (1, 0): angles, angle between, dot product. */
export function ropeScore(m, n, freq = FREQ) {
  const q = rotate([1, 0], m, freq);
  const k = rotate([1, 0], n, freq);
  return { qAngle: m * freq, kAngle: n * freq, between: Math.abs(m - n) * freq, dot: q[0] * k[0] + q[1] * k[1] };
}

const R = 95;      // circle
const LEN = 85;    // arrow length
const ARC = 40;    // radius of the "angle between" arc
const GRAB = 26;   // width of the invisible grab bar over each arrow
const CX = [190, 530];
const CY = 150;
const f1 = (x) => x.toFixed(1);
const f3 = (x) => x.toFixed(3);
const tip = (cx, angle, len = LEN) => [cx + len * Math.cos(angle), CY - len * Math.sin(angle)];

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const slider = (text, value) => ui.slider({ label: text, min: 0, max: MAX_POS, value });
  const get = {
    a0: slider("Left circle, query position m", DEFAULTS.a[0]),
    a1: slider("Left circle, key position n", DEFAULTS.a[1]),
    b0: slider("Right circle, query position m", DEFAULTS.b[0]),
    b1: slider("Right circle, key position n", DEFAULTS.b[1]),
  };
  const lock = ui.toggle({ label: "Move query and key of a circle together", checked: false });
  const box = get.a0.closest(".dg-controls");
  const hint = Object.assign(document.createElement("p"), { className: "dg-readout" });
  hint.textContent = "Drag a colored arrow, or use the sliders. One pair of numbers, 0.1 radian per position, query and key both start as (1, 0).";
  svg.before(hint);

  // With "together" on, moving one slider moves its partner by the same step, so
  // the angle between them stays put. Runs before the panel's own listener.
  const last = {};
  const partner = { a0: "a1", a1: "a0", b0: "b1", b1: "b0" };
  box.addEventListener("input", (event) => {
    const id = Object.keys(get).find((key) => get[key] === event.target);
    if (!id || !lock.checked) return;
    const mine = Number(get[id].value);
    const other = Number(get[partner[id]].value);
    let delta = mine - last[id];
    delta = Math.max(-other, Math.min(MAX_POS - other, delta));
    get[id].value = last[id] + delta;
    get[partner[id]].value = other + delta;
  }, true);

  // Invisible bars over the outer part of each arrow catch the pointer. They are
  // HTML boxes in a foreignObject because Chrome ignores touch-action on SVG
  // shapes. Made once and only moved, so a touch that began on one is not cut off.
  const handles = {};
  const grabs = svgEl("foreignObject", { x: 0, y: 0, width: 720, height: 330, style: "pointer-events:none;overflow:visible" });
  for (const id of Object.keys(get)) {
    handles[id] = document.createElement("div");
    handles[id].dataset.handle = id;
    handles[id].setAttribute("style", `position:absolute;height:${GRAB}px;transform-origin:0 50%;pointer-events:auto;cursor:grab;touch-action:none`);
    grabs.append(handles[id]);
  }
  svg.append(grabs);
  const pos = () => ({ a: [Number(get.a0.value), Number(get.a1.value)], b: [Number(get.b0.value), Number(get.b1.value)] });

  function draw() {
    const p = pos();
    for (const id of Object.keys(get)) last[id] = Number(get[id].value);
    const shapes = [arrowhead("rope-ah-0", "var(--c1)"), arrowhead("rope-ah-1", "var(--c2)")];
    const scores = [];
    ["a", "b"].forEach((side, i) => {
      const cx = CX[i];
      const [m, n] = p[side];
      const r = ropeScore(m, n);
      scores.push(r);
      shapes.push(svgEl("circle", { cx, cy: CY, r: R, fill: "none", stroke: "var(--border)", "stroke-width": 1.5 }));
      shapes.push(svgEl("line", { x1: cx - 100, y1: CY, x2: cx + 100, y2: CY, stroke: "var(--border)", "stroke-width": 1.5, "stroke-dasharray": "3 4" }));
      const qTip = tip(cx, r.qAngle);
      const kTip = tip(cx, r.kAngle);
      // The higher tip carries its label above it, the other below, so they do not collide.
      const qAbove = qTip[1] <= kTip[1];
      const arrow = (id, name, pos2, point, colour, above, angle) => {
        shapes.push(svgEl("line", { x1: cx, y1: CY, x2: point[0].toFixed(3), y2: point[1].toFixed(3), stroke: colour, "stroke-width": 3, "marker-end": `url(#rope-ah-${id[1]})` }));
        const left = Math.cos(angle) < -0.01;
        shapes.push(label(point[0] + (left ? -8 : 8), point[1] + (above ? -6 : 14), `${name} at ${pos2}`, {
          size: 14, anchor: left ? "end" : "start", fill: colour, weight: 600,
        }));
        const grab = tip(cx, angle, LEN * 0.4);
        const bar = handles[id].style;
        bar.left = `${grab[0]}px`;
        bar.top = `${grab[1] - GRAB / 2}px`;
        bar.width = `${LEN * 0.6 + 8}px`;
        bar.transform = `rotate(${-angle}rad)`;
      };
      arrow(`${side}0`, "q", m, qTip, "var(--c1)", qAbove, r.qAngle);
      arrow(`${side}1`, "k", n, kTip, "var(--c2)", !qAbove, r.kAngle);
      if (r.between > 1e-9) {
        const lo = Math.min(r.qAngle, r.kAngle);
        const hi = Math.max(r.qAngle, r.kAngle);
        const [x0, y0] = tip(cx, lo, ARC);
        const [x1, y1] = tip(cx, hi, ARC);
        shapes.push(svgEl("path", { d: `M ${f1(x0)},${f1(y0)} A ${ARC},${ARC} 0 ${hi - lo > Math.PI ? 1 : 0} 0 ${f1(x1)},${f1(y1)}`, stroke: "var(--c6)", "stroke-width": 3, fill: "none" }));
      }
      shapes.push(label(cx + 90, 174, `angle between: ${f1(r.between)}`, { size: 14, anchor: "end", fill: "var(--c6)", weight: 600 }));
      shapes.push(label(cx, 282, `m = ${m}, n = ${n}: angle between = ${f1(r.between)} rad`, { size: 15, anchor: "middle" }));
    });
    const same = Math.abs(p.a[0] - p.a[1]) === Math.abs(p.b[0] - p.b[1]);
    shapes.push(label(360, 314, same
      ? `Same relative distance, same dot product for these two vectors: cos(${f1(scores[0].between)}) = ${f3(scores[0].dot)}`
      : `Different relative distances, different dot products: cos(${f1(scores[0].between)}) = ${f3(scores[0].dot)}, cos(${f1(scores[1].between)}) = ${f3(scores[1].dot)}`,
    { size: 15, anchor: "middle", weight: 600 }));
    // Not redraw(): the invisible grab handles must stay in the DOM while a finger is on one.
    for (const child of [...svg.children]) {
      if (child !== grabs && !/^(title|desc|defs)$/.test(child.localName)) child.remove();
    }
    grabs.before(...shapes);

    const gap = (pair) => Math.abs(pair[0] - pair[1]);
    ui.say(
      `Left circle: the pair is ${gap(p.a)} positions apart, so the dot product is cos ${f1(scores[0].between)} = ${f3(scores[0].dot)}. ` +
        `Right circle: ${gap(p.b)} positions apart, cos ${f1(scores[1].between)} = ${f3(scores[1].dot)}.`,
      [
        ...[["Left circle", p.a, scores[0]], ["Right circle", p.b, scores[1]]].map(
          ([name, [m, n], r]) =>
            `${name}: the query at position ${m} is turned ${m} × 0.1 = ${f1(r.qAngle)} rad and the key at position ${n} is turned ${f1(r.kAngle)} rad, so they are ${f1(r.between)} rad apart and the dot product of the two unit vectors is cos ${f1(r.between)} = ${f3(r.dot)}.`,
        ),
        same
          ? `Both pairs are ${gap(p.a)} positions apart, so the angle between them and the score are the same.`
          : `The pairs are ${gap(p.a)} and ${gap(p.b)} positions apart, so the scores differ.`,
      ],
    );
  }

  // Dragging: the svg is rebuilt on every change, so the pointer is captured on
  // the svg itself, which stays. The drag writes the slider and fires its input event.
  let drag = null;
  const toSvg = (event) => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [point.x, point.y];
  };
  svg.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest?.("[data-handle]");
    if (!handle) return;
    drag = { id: handle.dataset.handle, pointer: event.pointerId };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const input = get[drag.id];
    const [x, y] = toSvg(event);
    const centre = CX[drag.id[0] === "a" ? 0 : 1];
    let angle = Math.atan2(CY - y, x - centre);
    const current = Number(input.value) * FREQ;
    angle += 2 * Math.PI * Math.round((current - angle) / (2 * Math.PI)); // nearest turn to where it is now
    const next = Math.max(0, Math.min(MAX_POS, Math.round(angle / FREQ)));
    if (next !== Number(input.value)) {
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  const end = (event) => {
    if (drag && event.pointerId === drag.pointer) drag = null;
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  ui.start();
}

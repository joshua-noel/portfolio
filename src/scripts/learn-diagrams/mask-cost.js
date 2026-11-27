// A slider for the length n: the grid of scores, how much of it the causal
// mask allows, and how fast the total grows.
import { addSlider, OFF, ON } from "./controls.js";

const NS = "http://www.w3.org/2000/svg";
const LEFT = 20;
const TOP = 40;
const SIZE = 240;

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const grid = svg.querySelector("[data-grid]");
  const total = svg.querySelector("[data-total]");
  const used = svg.querySelector("[data-used]");
  const [slider, output] = addSlider(svg, {
    label: "Tokens in the sequence, n",
    min: 2,
    max: 16,
    value: 6,
    name: "Number of tokens",
  });

  function draw(n) {
    const cell = SIZE / n;
    const gap = n > 10 ? 1 : 2;
    const rects = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const rect = document.createElementNS(NS, "rect");
        const allowed = col <= row;
        rect.setAttribute("style", allowed ? ON : OFF);
        if (allowed) rect.setAttribute("fill-opacity", "0.55");
        rect.setAttribute("x", LEFT + col * cell);
        rect.setAttribute("y", TOP + row * cell);
        rect.setAttribute("width", cell - gap);
        rect.setAttribute("height", cell - gap);
        rect.setAttribute("rx", Math.min(3, cell / 6));
        rects.push(rect);
      }
    }
    grid.replaceChildren(...rects);
    total.textContent = `n² = ${n * n}`;
    used.textContent = String((n * (n + 1)) / 2);
    output.textContent = String(n);
  }

  slider.addEventListener("input", () => draw(Number(slider.value)));
  draw(Number(slider.value));
}

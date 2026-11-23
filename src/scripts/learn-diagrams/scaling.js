// The same six scores, as the softmax sees them. The scores are fixed
// standard-normal draws e; without the scaling a dot product of two
// d_k-dimensional vectors with unit-variance entries has standard deviation
// sqrt(d_k), so the unscaled scores are sqrt(d_k) * e and the scaled ones are e.

import { addReadout, addSlider } from "./controls.js";

const EPSILON = [0.6, -0.2, 1.1, -0.7, 0.2, 0.9];
const WIDTHS = [4, 16, 64, 256, 1024];
const BASELINE = 200;
const HEIGHT = 150;

function softmax(scores) {
  const peak = Math.max(...scores);
  const exp = scores.map((s) => Math.exp(s - peak));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / total);
}

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const [slider, output] = addSlider(svg, {
    label: "Key width, d_k",
    min: 0,
    max: WIDTHS.length - 1,
    value: 2,
    name: "Key width d_k",
  });
  const note = addReadout(svg);

  function paint(name, weights) {
    const bars = svg.querySelectorAll(`[data-bars="${name}"] rect`);
    weights.forEach((weight, i) => {
      const h = weight * HEIGHT;
      bars[i].setAttribute("y", (BASELINE - h).toFixed(1));
      bars[i].setAttribute("height", h.toFixed(1));
    });
    svg.querySelector(`[data-max="${name}"]`).textContent = Math.max(...weights).toFixed(
      2,
    );
  }

  function draw() {
    const dk = WIDTHS[Number(slider.value)];
    const spread = Math.sqrt(dk);
    paint("raw", softmax(EPSILON.map((e) => e * spread)));
    paint("scaled", softmax(EPSILON));
    output.textContent = String(dk);
    note.textContent = `Scores here have standard deviation √${dk} = ${spread} without scaling, and 1 with it.`;
  }

  slider.addEventListener("input", draw);
  draw();
}

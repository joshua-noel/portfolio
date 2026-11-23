// Hover, focus or tap a query: the lines show how much it reads from each
// token. The numbers are read from the SVG's own data-q / data-k / data-v
// attributes and computed here, so the picture cannot drift from the maths.

const numbers = (text) => text.split(",").map(Number);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

function softmax(scores) {
  const peak = Math.max(...scores);
  const exp = scores.map((s) => Math.exp(s - peak));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / total);
}

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const queries = [...svg.querySelectorAll('[data-role="query"]')];
  const keys = [...svg.querySelectorAll('[data-role="key"]')];
  const lines = [...svg.querySelectorAll("[data-links] path")];
  const pills = [...svg.querySelectorAll("[data-pills] g")];
  const mix = svg.querySelector("[data-mix]");
  const out = svg.querySelector("[data-out]");

  const scale = Math.sqrt(numbers(keys[0].dataset.k).length);
  const centre = (group) => {
    const box = group.querySelector("rect");
    return Number(box.getAttribute("y")) + Number(box.getAttribute("height")) / 2;
  };
  const fromX = 130;
  const toX = 270;

  function select(query) {
    const q = numbers(query.dataset.q);
    const weights = softmax(keys.map((key) => dot(q, numbers(key.dataset.k)) / scale));
    const y0 = centre(query);

    queries.forEach((other) => other.classList.toggle("is-selected", other === query));
    keys.forEach((key, i) => {
      const y1 = centre(key);
      lines[i].setAttribute("d", `M${fromX} ${y0} L${toX} ${y1}`);
      lines[i].setAttribute("stroke-width", (1 + 14 * weights[i]).toFixed(2));
      const t = 0.75;
      pills[i].setAttribute(
        "transform",
        `translate(${fromX + (toX - fromX) * t} ${y0 + (y1 - y0) * t})`,
      );
      pills[i].querySelector("text").textContent = weights[i].toFixed(2);
    });

    const values = keys.map((key) => numbers(key.dataset.v));
    const result = values[0].map((_, d) =>
      values.reduce((sum, v, i) => sum + weights[i] * v[d], 0),
    );
    const name = query.dataset.name;
    mix.textContent =
      `${name} reads ` +
      keys.map((key, i) => `${weights[i].toFixed(2)} ${key.dataset.name}`).join(" + ");
    out.textContent = `output = (${result.map((v) => v.toFixed(2)).join(", ")})`;
  }

  for (const query of queries) {
    query.addEventListener("pointerenter", () => select(query));
    query.addEventListener("focus", () => select(query));
    query.addEventListener("click", () => select(query));
    query.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(query);
      }
    });
  }
}

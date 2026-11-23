// Shared by the diagrams that have a slider. A diagram file is plain SVG, so
// the controls are built here, as ordinary HTML beside it.

/** Adds `<label>text <input type=range> <output></label>` before the SVG; returns [input, output]. */
export function addSlider(svg, { label, min, max, value, step = 1, name }) {
  const wrap = document.createElement("div");
  wrap.className = "dg-controls";
  const text = document.createElement("label");
  text.append(`${label} `);
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min, max, value, step });
  input.setAttribute("aria-label", name);
  const output = document.createElement("output");
  text.append(input, output);
  wrap.append(text);
  svg.before(wrap);
  return [input, output];
}

/** Adds a live-region sentence after the SVG. */
export function addReadout(svg) {
  const note = document.createElement("p");
  note.className = "dg-readout";
  note.setAttribute("aria-live", "polite");
  svg.after(note);
  return note;
}

export const ON = "fill:var(--accent);stroke:var(--accent)";
export const OFF = "fill:var(--surface);stroke:var(--border)";

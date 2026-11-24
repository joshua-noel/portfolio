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

// ---- Shared by the newer diagrams: a panel of real form controls, a reset
// button, and a drawing that is rebuilt from the model on every change. The
// model is a pure function in each module, which the tests call; the drawing
// only shows what it returns.

export const NS = "http://www.w3.org/2000/svg";

/** An SVG element with attributes, and text if given. */
export function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A label on the diagram, in the course's text color unless told otherwise. */
export function label(x, y, text, { size = 13, anchor = "start", fill = "currentColor", weight } = {}) {
  const attrs = { x, y, "font-size": size, "text-anchor": anchor, fill };
  if (weight) attrs["font-weight"] = weight;
  return svgEl("text", attrs, text);
}

/** An arrowhead in the color of its line: draw the line with marker-end="url(#id)". */
export function arrowhead(id, color) {
  const marker = svgEl("marker", {
    id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse",
  });
  marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
  return marker;
}

/** Replaces the drawing, keeping the file's own <title>, <desc> and <defs>. */
export function redraw(svg, shapes) {
  for (const child of [...svg.children]) {
    if (!/^(title|desc|defs)$/.test(child.localName)) child.remove();
  }
  svg.append(...shapes);
}

/** Rounds like the lecture's tables do: thousands with a comma. */
export const thousands = (n) => Math.round(n).toLocaleString("en-US");

/**
 * Builds the controls before the SVG, and after it the result in a sentence or
 * two (a live region) and, behind "How this is computed", whatever else the
 * reader may want to check: the model's rule, the lecture's own figures, what the
 * model leaves out. `draw` is called after every change and once at the start.
 * Controls: slider, toggle, choice (a select); a Reset button is added last.
 */
export function panel(svg, draw) {
  const box = document.createElement("div");
  box.className = "dg-controls";
  const note = document.createElement("p");
  note.className = "dg-readout";
  note.setAttribute("aria-live", "polite");
  const more = document.createElement("details");
  more.className = "dg-more";
  more.hidden = true;
  const summary = document.createElement("summary");
  summary.textContent = "How this is computed";
  const detail = document.createElement("div");
  more.append(summary, detail);
  svg.before(box);
  svg.after(note);
  note.after(more);
  const resets = [];
  const outputs = [];
  let buttons;

  const field = (text, input, output) => {
    const wrap = document.createElement("label");
    wrap.append(`${text} `, input);
    if (output) wrap.append(output);
    box.append(wrap);
  };
  const change = () => {
    for (const refresh of outputs) refresh();
    draw();
  };

  const ui = {
    slider({ label: text, min, max, value, step = 1, format = String }) {
      const input = Object.assign(document.createElement("input"), {
        type: "range", min, max, step, value,
      });
      const output = document.createElement("output");
      const show = () => {
        output.textContent = format(Number(input.value));
        input.setAttribute("aria-valuetext", output.textContent);
      };
      outputs.push(show);
      input.addEventListener("input", change);
      resets.push(() => (input.value = value));
      field(text, input, output);
      return input;
    },
    toggle({ label: text, checked = false }) {
      const input = Object.assign(document.createElement("input"), { type: "checkbox", checked });
      input.addEventListener("change", change);
      resets.push(() => (input.checked = checked));
      field(text, input);
      return input;
    },
    choice({ label: text, options, value }) {
      const input = document.createElement("select");
      for (const [key, name] of options) input.append(new Option(name, key));
      input.value = value;
      input.addEventListener("change", change);
      resets.push(() => (input.value = value));
      field(text, input);
      return input;
    },
    button(text, onClick) {
      const button = Object.assign(document.createElement("button"), { type: "button", textContent: text });
      button.addEventListener("click", () => {
        onClick();
        change();
      });
      if (!buttons) {
        buttons = document.createElement("div");
        buttons.className = "dg-buttons";
        box.append(buttons);
      }
      buttons.append(button);
      return button;
    },
    /**
     * The result, in one or two short sentences (read out when it changes), and
     * optionally what is behind it: a string or a list of paragraphs, shown only
     * when the reader opens "How this is computed".
     */
    say(text, explanation = []) {
      note.textContent = text;
      const paragraphs = [explanation].flat().filter(Boolean);
      detail.replaceChildren(
        ...paragraphs.map((paragraph) => Object.assign(document.createElement("p"), { textContent: paragraph })),
      );
      more.hidden = paragraphs.length === 0;
    },
    /** Adds the Reset button (last) and draws the first state. */
    start(onReset = () => {}) {
      ui.button("Reset", () => {
        for (const reset of resets) reset();
        onReset();
      });
      change();
    },
  };
  return ui;
}

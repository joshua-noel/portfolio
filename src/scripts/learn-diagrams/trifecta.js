// Agent Systems, lecture 7, section 3: the lethal trifecta. Data theft needs
// three capabilities at once; with any one missing "this class of attack
// closes". `exposure` is that rule. TOOLS is the lecture's worked-example
// table (which capabilities each of six tools provides); it only supplies the
// "which tools would you remove" hint, and the test checks it against the
// lecture's count of 34 exposed subsets out of 63.
import { label, panel, redraw, svgEl } from "./controls.js";

export const CONDITIONS = [
  { id: "private", name: "Access to private data", detail: "inbox, files, repos", short: "private data" },
  { id: "untrusted", name: "Exposure to untrusted content", detail: "web pages, emails, issues", short: "untrusted content" },
  { id: "external", name: "Ability to communicate externally", detail: "HTTP, email, links, image loads", short: "communicate externally" },
];
export const TOOLS = {
  read_inbox: ["private", "untrusted"],
  read_files: ["private"],
  search_web: ["untrusted", "external"],
  send_email: ["external"],
  read_issues: ["untrusted"],
  calculator: [],
};

/** Exposed to data theft only if all three conditions hold; `missing` lists the ones that do not. */
export function exposure(on) {
  const missing = CONDITIONS.map((c) => c.id).filter((id) => !on[id]);
  return { exposed: missing.length === 0, missing };
}

/** The tools that provide a condition in the lecture's six-tool example. */
export const providers = (id) => Object.keys(TOOLS).filter((tool) => TOOLS[tool].includes(id));

const CIRCLES = { private: [270, 150, "var(--c5)"], untrusted: [450, 150, "var(--c6)"], external: [360, 255, "var(--c2)"] };
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0]);

export default function init(figure) {
  const svg = figure.querySelector("svg");
  const ui = panel(svg, draw);
  const get = {};
  for (const c of CONDITIONS) get[c.id] = ui.toggle({ label: `${c.name} (${c.detail})`, checked: true });

  function draw() {
    const on = Object.fromEntries(CONDITIONS.map((c) => [c.id, get[c.id].checked]));
    const { exposed, missing } = exposure(on);
    const ink = (id) => (on[id] ? "currentColor" : "var(--muted)");
    const off = (id) => (on[id] ? "" : " (off)");
    const shapes = [];
    for (const [id, [cx, cy, colour]] of Object.entries(CIRCLES)) {
      shapes.push(svgEl("circle", on[id]
        ? { cx, cy, r: 110, fill: colour, "fill-opacity": 0.14, stroke: colour, "stroke-width": 3 }
        : { cx, cy, r: 110, fill: "none", stroke: "var(--muted)", "stroke-width": 2, "stroke-dasharray": "8 6" }));
    }
    shapes.push(label(170, 40, "Access to", { size: 14, anchor: "end", fill: ink("private"), weight: 700 }));
    shapes.push(label(170, 58, `private data${off("private")}`, { size: 14, anchor: "end", fill: ink("private"), weight: 700 }));
    shapes.push(label(170, 78, "inbox, files, repos", { anchor: "end", fill: ink("private") }));
    shapes.push(label(550, 40, "Exposure to", { size: 14, fill: ink("untrusted"), weight: 700 }));
    shapes.push(label(550, 58, `untrusted content${off("untrusted")}`, { size: 14, fill: ink("untrusted"), weight: 700 }));
    shapes.push(label(550, 78, "web pages, emails, issues", { fill: ink("untrusted") }));
    shapes.push(label(360, 392, `Ability to communicate externally${off("external")}`, { size: 14, anchor: "middle", fill: ink("external"), weight: 700 }));
    shapes.push(label(360, 411, "HTTP, email, links, image loads", { anchor: "middle", fill: ink("external") }));

    if (exposed) {
      shapes.push(svgEl("circle", { cx: 360, cy: 190, r: 5, fill: "var(--fg)" }));
      shapes.push(svgEl("line", { x1: 366, y1: 190, x2: 520, y2: 250, stroke: "var(--muted)", "stroke-width": 2 }));
      shapes.push(label(528, 262, "All three overlap:", { size: 14, weight: 700 }));
      shapes.push(label(528, 281, "an attacker can", { size: 14 }));
      shapes.push(label(528, 300, "steal your data.", { size: 14 }));
      ["Remove one circle,", "and that attack", "is gone."].forEach((line, i) => shapes.push(label(528, 336 + 18 * i, line)));
    } else {
      shapes.push(label(528, 262, "Not all three:", { size: 14, weight: 700 }));
      shapes.push(label(528, 281, "this class of attack", { size: 14 }));
      shapes.push(label(528, 300, "is closed.", { size: 14 }));
      shapes.push(label(528, 336, "Missing:"));
      missing.forEach((id, i) => shapes.push(label(528, 354 + 18 * i, CONDITIONS.find((c) => c.id === id).short)));
    }
    redraw(svg, shapes);

    const states = CONDITIONS.map((c) => `${c.name}: ${on[c.id] ? "on" : "off"}`).join(". ");
    if (exposed) {
      ui.say(
        "All three are on, so an attacker can steal your data. Turn off any one and that attack is closed.",
        [states + ".", "This diagram covers data theft only, not the other impacts of injection the lecture lists."],
      );
    } else {
      const names = missing.map((id) => CONDITIONS.find((c) => c.id === id).name.toLowerCase());
      const hints = missing.map((id, i) => `for ${names[i]}, remove ${list(providers(id))}`);
      ui.say(
        `Not all three are on, so this attack (data theft) is closed. Missing: ${list(names)}.`,
        [
          states + ".",
          `Closing a leg means removing every tool that provides it. In the lecture's six-tool example: ${hints.join("; ")}.`,
          "This diagram covers data theft only, not the other impacts of injection the lecture lists.",
        ],
      );
    }
  }
  ui.start();
}

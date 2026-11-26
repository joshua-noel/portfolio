import { parseFragment, serialize } from "parse5";

/**
 * A diagram is an SVG file written outside this repository, and it is placed
 * in the page as markup. So it is parsed the way a browser parses it, every
 * element and attribute is checked against a list of what diagrams need, and
 * what is inlined is the serialised result of that parse, not the file's own
 * text: nothing the check did not look at can reach the page.
 *
 * Case does not matter: the HTML parser lower-cases names, then restores the
 * camel case of the SVG ones (`viewBox`, `linearGradient`), so `<SCRIPT>` and
 * `ONLOAD=` are what they are. Anything not listed is an error, which is what
 * keeps scripts, `foreignObject`, event handlers, `<style>`, animation
 * (`<set>` and `<animate>` can rewrite an `href` after the check), embedded
 * images and external references out.
 */

const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "marker",
  "path",
  "text",
  "tspan",
  "rect",
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "use",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
]);

/** Lower-case, as the parser delivers names. */
const ATTRIBUTES = new Set(
  [
    // identity and accessibility
    "id",
    "class",
    "role",
    "tabindex",
    "lang",
    // geometry
    "viewBox",
    "preserveAspectRatio",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "width",
    "height",
    "d",
    "points",
    "dx",
    "dy",
    "transform",
    "refX",
    "refY",
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "orient",
    "offset",
    "gradientUnits",
    "gradientTransform",
    "clipPathUnits",
    "textLength",
    "lengthAdjust",
    // presentation
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "opacity",
    "stop-color",
    "stop-opacity",
    "marker-start",
    "marker-mid",
    "marker-end",
    "clip-path",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "letter-spacing",
    "text-decoration",
    "style",
    "display",
    "visibility",
  ].map((name) => name.toLowerCase()),
);

/** `href` may only point inside the document, and only these elements use it. */
const REFERENCING = new Set(["use", "linearGradient", "radialGradient"]);

/** What `style` may set: the presentation attributes above, as properties. */
const STYLE_PROPERTIES = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "stop-color",
  "stop-opacity",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "text-decoration",
  "display",
  "visibility",
]);

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Characters a browser ignores inside a scheme, so `java\tscript:` is `javascript:`. */
const squash = (value: string): string => value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();

/**
 * Anything in a value that could fetch, run or import: a scheme, a `url(...)`
 * that is not a same-document `#id`, an `@import`, an IE `expression(`, a
 * CSS escape, a comment, or markup. `url(#id)` is how gradients and markers
 * are referenced and is fine.
 */
function dangerousValue(value: string): string | undefined {
  const flat = squash(value);
  if (/(?:java|vb)script:|data:|file:|https?:|\/\//.test(flat)) return "a link or script";
  if (/@import|expression\(|-moz-binding|behavior:/.test(flat)) return "script in a style";
  if (/[<>\\]|\/\*/.test(value)) return "markup, an escape or a comment";
  for (const match of value.matchAll(/url\(\s*([^)]*)\)/gi)) {
    if (!/^["']?#[\w-]+["']?$/.test(match[1]!.trim())) return "url() to anything but #id";
  }
  return undefined;
}

function checkStyle(value: string): string | undefined {
  const bad = dangerousValue(value);
  if (bad) return bad;
  for (const declaration of value.split(";")) {
    if (declaration.trim() === "") continue;
    const colon = declaration.indexOf(":");
    const property = declaration.slice(0, colon).trim().toLowerCase();
    // Custom properties carry the theme's colours (`fill: var(--c1)`), never set here.
    if (colon === -1 || !STYLE_PROPERTIES.has(property)) {
      return `the style property "${property || declaration.trim()}"`;
    }
  }
  return undefined;
}

interface Attribute {
  name: string;
  value: string;
  prefix?: string;
  namespace?: string;
}

interface Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: Attribute[];
  childNodes?: Node[];
  content?: Node;
  value?: string;
}

/**
 * The `data-` attributes a diagram may carry: the ones its interactive script
 * reads. Any other would be read by the page's own scripts, which find their
 * hooks by `data-` names (`data-mark`, `data-book`, `data-search`…), so a
 * diagram could break the page it is inlined in. An unlisted one is refused.
 */
export const DIAGRAM_DATA = new Set([
  "data-interactive",
  "data-name",
  "data-k",
  "data-handle",
  "data-v",
  "data-q",
  "data-role",
  "data-used",
  "data-total",
  "data-pills",
  "data-out",
  "data-mix",
  "data-max",
  "data-links",
  "data-grid",
  "data-bars",
  "data-flow",
  "data-parallel",
  "data-constrained",
]);

/**
 * Checks a diagram's, or a cover's, SVG. `html` is the sanitised markup to
 * inline, and is empty when there is any problem; `issues` says each one.
 *
 * A cover is stricter, because it stands on the landing page once for every
 * course and next to the page's own markup: it has no `data-` attribute (the
 * old `data-mark`, four numbers, is accepted and dropped), its `id` and
 * `class` attributes are removed so it can neither clash with nor be styled
 * or found by the page, and it may reference nothing by id.
 */
export function sanitizeSvg(
  source: string,
  { kind = "diagram" }: { kind?: "diagram" | "cover" } = {},
): { html: string; issues: string[] } {
  const issues: string[] = [];
  const bad = (message: string): void => {
    if (!issues.includes(message)) issues.push(message);
  };
  const root = parseFragment(source) as unknown as Node;

  const walk = (node: Node, inside: boolean): void => {
    // Comments are dropped from the tree, so they are not in what is inlined.
    node.childNodes = (node.childNodes ?? []).filter((child) => child.nodeName !== "#comment");
    for (const child of node.childNodes) {
      if (child.nodeName === "#text") {
        if (!inside && (child.value ?? "").trim() !== "") bad("text outside the <svg>");
        continue;
      }
      const tag = child.tagName ?? child.nodeName;
      if (child.namespaceURI !== SVG_NAMESPACE || !ELEMENTS.has(tag)) {
        bad(
          `<${tag}> is not allowed in a diagram` +
            (/^(script|foreignobject|style|set|animate|image|a|iframe)/i.test(tag)
              ? ""
              : ` (allowed: ${[...ELEMENTS].join(", ")})`),
        );
        continue;
      }
      if (!inside && tag !== "svg") bad(`<${tag}> outside the <svg>`);
      if (inside && tag === "svg") bad("must contain exactly one <svg>");
      for (const attr of child.attrs ?? []) checkAttribute(tag, attr);
      if (kind === "cover") {
        child.attrs = (child.attrs ?? []).filter((attr) => {
          const name = attr.name.toLowerCase();
          return !attr.prefix && name !== "id" && name !== "class" && name !== "data-mark";
        });
      }
      walk(child, true);
    }
  };

  const checkAttribute = (tag: string, attr: Attribute): void => {
    const qualified = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
    const name = attr.name.toLowerCase();

    if (qualified === "xmlns" || qualified === "xmlns:xlink") {
      const expected = qualified === "xmlns" ? SVG_NAMESPACE : XLINK_NAMESPACE;
      if (attr.value !== expected) bad(`${qualified} must be ${expected}`);
      return;
    }
    if (kind === "cover" && (name === "href" || /url\(/i.test(attr.value))) {
      bad("a cover may not reference anything by id");
      return;
    }
    if (name === "href" && (attr.prefix === undefined || attr.prefix === "xlink")) {
      if (!REFERENCING.has(tag)) bad(`<${tag}> may not have an href`);
      else if (!/^#[\w-]+$/.test(attr.value)) {
        bad(`href="${attr.value}": only a #id in this diagram is allowed`);
      }
      return;
    }
    if (attr.prefix) {
      bad(`the attribute ${qualified} is not allowed`);
      return;
    }
    if (name.startsWith("data-")) {
      if (kind === "cover") {
        if (!(name === "data-mark" && /^\d{1,3}( \d{1,3}){3}$/.test(attr.value))) {
          bad(`the attribute ${name} is not allowed on a cover`);
        }
      } else if (!DIAGRAM_DATA.has(name)) bad(`the attribute ${name} is not allowed`);
      else if (dangerousValue(attr.value)) bad(`${name}="${attr.value}" is not allowed`);
      return;
    }
    if (name.startsWith("aria-")) {
      if (!/^aria-[a-z]+$/.test(name)) bad(`the attribute ${name} is not allowed`);
      return;
    }
    if (!ATTRIBUTES.has(name)) {
      bad(
        /^on/.test(name)
          ? `the event handler ${name} is not allowed`
          : `the attribute ${name} is not allowed`,
      );
      return;
    }
    if (name === "style") {
      const why = checkStyle(attr.value);
      if (why) bad(`style="${attr.value}": ${why} is not allowed`);
      return;
    }
    if (name === "id" || name === "class") {
      if (!/^[A-Za-z0-9_\s.:-]*$/.test(attr.value)) bad(`${name}="${attr.value}" is not allowed`);
      return;
    }
    const why = dangerousValue(attr.value);
    if (why) bad(`${name}="${attr.value}": ${why} is not allowed`);
  };

  walk(root, false);
  const svgs = (root.childNodes ?? []).filter((node) => node.tagName === "svg");
  if (svgs.length !== 1) bad("must contain exactly one <svg>");
  return { html: issues.length === 0 ? serialize(root as never).trim() : "", issues };
}

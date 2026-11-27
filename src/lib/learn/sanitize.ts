import type { HNode } from "./render.ts";

/**
 * Lecture Markdown may carry raw HTML: the contract uses `<details>` and a
 * little inline formatting. Anything else a lecture says in HTML is cut here,
 * so a lecture file (or a paste into one) cannot bring script, event
 * handlers, `javascript:` links, frames, forms or styles into the page.
 *
 * It is an allow-list on the parsed tree, run after raw HTML has been parsed
 * and before KaTeX adds its own markup: what remains is what Markdown itself
 * produces plus the small set below. `style` is never kept; the learn host's
 * Content-Security-Policy would permit a style attribute, and an author has no
 * need of one.
 */

const ELEMENTS = new Set(
  (
    "a abbr b blockquote br caption cite code col colgroup dd del details div dl dt em " +
    "figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q s " +
    "samp section small span strong sub summary sup table tbody td tfoot th thead tr u ul var wbr"
  ).split(" "),
);

/** Cut with everything inside them; any other unknown element is unwrapped, its text kept. */
const DROPPED = new Set(
  (
    "script style iframe frame frameset object embed applet noscript template svg math " +
    "form textarea select option button link meta base title head audio video source " +
    "track canvas dialog portal slot"
  ).split(" "),
);

/** Attributes any kept element may have, as hast spells them. */
const GLOBAL = new Set(["id", "className", "title", "lang", "dir", "role"]);

const PER_ELEMENT: Record<string, string[]> = {
  a: ["href"],
  img: ["src", "alt", "width", "height", "loading"],
  details: ["open"],
  ol: ["start", "reversed"],
  li: ["value"],
  td: ["align", "colSpan", "rowSpan"],
  th: ["align", "colSpan", "rowSpan", "scope"],
  col: ["span"],
  colgroup: ["span"],
  input: ["type", "checked", "disabled"],
};

/** Markdown's own footnote markup. */
const FOOTNOTE = new Set(["dataFootnotes", "dataFootnoteRef", "dataFootnoteBackref"]);

const ID = /^[A-Za-z0-9_.:-]+$/;
const CLASS = /^[A-Za-z0-9_:+#.-]+$/;

/** A link is relative, `#frag`, or http, https or mailto: nothing a browser would run. */
function safeUrl(value: string): boolean {
  const flat = value.replace(/[\s\u0000-\u001f]+/g, "");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(flat)?.[1]?.toLowerCase();
  return scheme === undefined || scheme === "http" || scheme === "https" || scheme === "mailto";
}

function keep(tag: string, name: string, value: unknown): unknown {
  const allowed =
    GLOBAL.has(name) ||
    FOOTNOTE.has(name) ||
    /^aria[A-Z][A-Za-z]*$/.test(name) ||
    PER_ELEMENT[tag]?.includes(name);
  if (!allowed) return undefined;

  if (name === "href" || name === "src") {
    return typeof value === "string" && safeUrl(value) ? value : undefined;
  }
  if (name === "id") return typeof value === "string" && ID.test(value) ? value : undefined;
  if (name === "className") {
    const classes = (Array.isArray(value) ? value : String(value).split(/\s+/)).map(String);
    const clean = classes.filter((token) => CLASS.test(token));
    return clean.length > 0 ? clean : undefined;
  }
  if (name === "type") return value === "checkbox" ? value : undefined;
  if (name === "loading") return value === "lazy" || value === "eager" ? value : undefined;
  return value;
}

function clean(node: HNode): HNode[] {
  if (node.type === "text") return [node];
  if (node.type === "root") {
    node.children = (node.children ?? []).flatMap(clean);
    return [node];
  }
  // Comments, doctypes, and anything unparsed: gone.
  if (node.type !== "element" || !node.tagName) return [];

  const tag = node.tagName;
  if (DROPPED.has(tag)) return [];
  const children = (node.children ?? []).flatMap(clean);
  if (!ELEMENTS.has(tag)) return children;
  // The one input Markdown makes is a disabled task-list checkbox.
  if (tag === "input" && node.properties?.type !== "checkbox") return [];

  const properties: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.properties ?? {})) {
    const kept = keep(tag, name, value);
    if (kept !== undefined) properties[name] = kept;
  }
  if (tag === "input") properties.disabled = true;
  node.properties = properties;
  node.children = children;
  return [node];
}

/** A rehype transformer: removes whatever lecture HTML is not on the list. */
export function sanitize(tree: HNode): void {
  clean(tree);
}

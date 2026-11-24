import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import GithubSlugger from "github-slugger";
import katex from "katex";
import { visit, SKIP } from "unist-util-visit";
import type { Depth } from "./depth.ts";
import { sanitize } from "./sanitize.ts";

/**
 * Markdown to HTML for lectures. Everything slow happens here, once, when the
 * server first needs the lecture: syntax highlighting and maths are both
 * rendered on the server, so the browser gets finished HTML and no library.
 *
 * Unlike src/lib/markdown.ts this renderer is stateful. A lecture arrives as
 * several chunks (one per depth layer), and heading ids, section numbers and
 * word counts must run on across all of them, so one `Renderer` renders one
 * whole lecture.
 */

export interface HNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  value?: string;
}

export interface Heading {
  id: string;
  /** Plain text; for a numbered section this excludes the number. */
  text: string;
  depth: 2 | 3 | 4;
  /** The depth layer that contains it: it is on screen only at this depth or deeper. */
  layer: Depth;
  /** From "## 3. Title". */
  number?: number;
  /** The unnumbered sections of the Waterline. */
  frame?: FrameSection;
}

/** The unnumbered sections every Waterline has. */
export const FRAME_SECTIONS = {
  "the idea in one paragraph": "idea",
  "worked example": "example",
  "check yourself": "check",
  references: "references",
} as const;

export type FrameSection = (typeof FRAME_SECTIONS)[keyof typeof FRAME_SECTIONS];

/** What the renderer saw while rendering; the lecture's structural checks read it. */
export interface Facts {
  headings: Heading[];
  /** Problems found while rendering, as sentences. */
  issues: string[];
  ideaParagraphs: number;
  /** Source ids that appear as [Id] in the text. */
  cited: Set<string>;
  /** Plain text of everything rendered, for search. */
  text: string[];
}

const classesOf = (node: HNode): string[] => {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : [];
};

const isElement = (node: HNode, tag: string): boolean =>
  node.type === "element" && node.tagName === tag;

/** Text of a node, with maths and code left out; both read as symbols, not prose. */
function proseText(node: HNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type !== "element") return "";
  if (node.tagName === "pre") return "";
  if (node.tagName === "code" && classesOf(node).includes("language-math")) return "";
  return (node.children ?? []).map(proseText).join("");
}

function rawText(node: HNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(rawText).join("");
}

const text = (value: string): HNode => ({ type: "text", value });

const element = (
  tagName: string,
  properties: Record<string, unknown>,
  children: HNode[],
): HNode => ({ type: "element", tagName, properties, children });

const CALLOUTS: Record<string, string> = {
  "Note.": "note",
  "Common mistake.": "mistake",
};

export class Renderer {
  readonly facts: Facts = {
    headings: [],
    issues: [],
    ideaParagraphs: 0,
    cited: new Set(),
    text: [],
  };

  private readonly slugger = new GithubSlugger();
  private layer: Depth = "waterline";
  private section: FrameSection | "" = "";
  private readonly sources: ReadonlySet<string>;

  constructor(sourceIds: ReadonlySet<string> = new Set()) {
    this.sources = sourceIds;
  }

  private readonly processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(() => (tree: unknown) => this.inspect(tree as HNode))
    .use(() => (tree: unknown) => this.cite(tree as HNode))
    .use(() => (tree: unknown) => smarten(tree as HNode))
    // Raw HTML is parsed first, and cut down to the small set a lecture may
    // use (sanitize.ts) before KaTeX adds its own markup, which is trusted
    // and needs a second parse. The second use is a distinct plugin function:
    // unified would merge a repeated plugin into the first.
    .use(rehypeRaw)
    .use(() => (tree: unknown) => sanitize(tree as HNode))
    .use(() => (tree: unknown) => renderMath(tree as HNode))
    .use(() => rehypeRaw())
    .use(rehypeShiki, {
      // CSS variables, not baked colours, so code follows the theme toggle.
      // The -default dark theme because plain github-dark greys comments
      // out to 3:1.
      themes: { light: "github-light", dark: "github-dark-default" },
      defaultColor: false,
      defaultLanguage: "text",
      fallbackLanguage: "text",
    })
    .use(() => (tree: unknown) => wrapTables(tree as HNode))
    .use(rehypeStringify);

  /** Renders a chunk of Markdown written for `layer`. */
  async render(markdown: string, layer: Depth): Promise<string> {
    this.layer = layer;
    return String(await this.processor.process(markdown));
  }

  /** A caption or a question: inline content, so the wrapping <p> goes. */
  async renderInline(markdown: string, layer: Depth): Promise<string> {
    const html = await this.render(markdown, layer);
    return html.replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1").trim();
  }

  private issue(message: string): void {
    this.facts.issues.push(message);
  }

  private inspect(tree: HNode): void {
    const { facts } = this;
    for (const node of tree.children ?? []) {
      if (node.type !== "element" || !node.tagName) continue;
      const tag = node.tagName;

      if (/^h[1-6]$/.test(tag)) {
        this.heading(node, Number(tag[1]));
        continue;
      }

      const prose = proseText(node);
      if (prose.trim() !== "" && this.section !== "references") facts.text.push(prose);

      if (tag === "blockquote") this.callout(node);
      if (this.layer === "waterline" && this.section === "idea" && tag === "p") {
        facts.ideaParagraphs += 1;
      }
    }
  }

  /** `> **Note.**` and `> **Common mistake.**` become styled callouts. */
  private callout(node: HNode): void {
    const first = (node.children ?? []).find((child) => isElement(child, "p"));
    const lead = first?.children?.find((child) => isElement(child, "strong"));
    const kind = lead ? CALLOUTS[rawText(lead).trim()] : undefined;
    if (kind)
      node.properties = { ...node.properties, className: ["callout", `callout-${kind}`] };
  }

  /** `[Transformer]` links to its entry in the references, if that is a source id. */
  private cite(tree: HNode): void {
    const visitNode = (node: HNode): void => {
      const children = node.children;
      if (!children || ["code", "pre", "a"].includes(node.tagName ?? "")) return;
      const out: HNode[] = [];
      for (const child of children) {
        if (child.type !== "text" || child.value === undefined) {
          visitNode(child);
          out.push(child);
          continue;
        }
        let rest = child.value;
        for (
          let match = /\[([A-Za-z][A-Za-z0-9_-]*)\]/.exec(rest);
          match;
          match = /\[([A-Za-z][A-Za-z0-9_-]*)\]/.exec(rest)
        ) {
          const id = match[1]!;
          const known = this.sources.has(id);
          if (!known && !/^[A-Z][A-Za-z0-9]{2,}$/.test(id)) {
            // Not a citation: leave the brackets alone and look past them.
            out.push(text(rest.slice(0, match.index + match[0].length)));
            rest = rest.slice(match.index + match[0].length);
            continue;
          }
          if (!known) this.issue(`[${id}] is not a source id in the front matter`);
          this.facts.cited.add(id);
          if (match.index > 0) out.push(text(rest.slice(0, match.index)));
          out.push(
            element("a", { className: ["cite"], href: `#ref-${id}` }, [text(`[${id}]`)]),
          );
          rest = rest.slice(match.index + match[0].length);
        }
        if (rest !== "") out.push(text(rest));
      }
      node.children = out;
    };
    visitNode(tree);
  }

  private heading(node: HNode, depth: number): void {
    const label = proseText(node).trim();
    if (depth === 1) {
      this.issue(`"# ${label}": only Tip, Waterline, Deep and Abyss are "#" sections`);
      return;
    }
    if (depth > 4) {
      this.issue(`"${label}": headings go no deeper than "####"`);
      return;
    }

    const numbered = /^(\d+)\.\s+(.+)$/.exec(label);
    const heading: Heading = {
      id: "",
      text: numbered ? numbered[2]! : label,
      depth: depth as 2 | 3 | 4,
      layer: this.layer,
    };
    const classes: string[] = [];

    if (depth === 2) {
      const frame = (FRAME_SECTIONS as Record<string, FrameSection>)[label.toLowerCase()];
      this.section = this.layer === "waterline" ? (frame ?? "") : "";
      if (numbered) {
        heading.number = Number(numbered[1]);
        classes.push("numbered");
        const first = (node.children ?? []).find((child) => child.type === "text");
        if (first?.value) first.value = first.value.replace(/^\d+\.\s+/, "");
        node.children = [
          element("span", { className: ["sec-no"], ariaHidden: "true" }, [
            text(String(heading.number)),
          ]),
          ...(node.children ?? []),
        ];
      } else if (frame && this.layer === "waterline") {
        heading.frame = frame;
        classes.push("frame", `frame-${frame}`);
      }
    }

    heading.id = this.slugger.slug(heading.text);
    node.properties = { ...node.properties, id: heading.id, className: classes };
    node.children = [
      ...(node.children ?? []),
      element(
        "a",
        {
          className: ["anchor"],
          href: `#${heading.id}`,
          ariaLabel: `Link to \u201c${heading.text}\u201d`,
        },
        [text("#")],
      ),
    ];
    this.facts.headings.push(heading);
  }
}

/**
 * Curly quotes, in prose only. A quote is an opening one when it follows
 * whitespace, an opening bracket or a dash, or starts a block; after a word,
 * or after an inline element such as <strong>, it closes.
 */
export function smarten(node: HNode): void {
  const children = node.children;
  if (!children || node.tagName === "code" || node.tagName === "pre") return;
  children.forEach((child, index) => {
    if (child.type !== "text" || child.value === undefined) return smarten(child);
    const value = child.value;
    child.value = value.replace(/["']/g, (quote, at: number) => {
      const before = at > 0 ? value[at - 1]! : index > 0 ? "x" : " ";
      const opening = /[\s([{\u2013\u2014]/.test(before);
      if (quote === '"') return opening ? "\u201c" : "\u201d";
      return opening ? "\u2018" : "\u2019";
    });
  });
}

/** remark-math leaves `<code class="language-math">`; KaTeX turns it into markup. */
function renderMath(tree: HNode): void {
  const render = (source: string, displayMode: boolean): HNode => ({
    type: "raw",
    value: katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: "error",
      trust: false,
      output: "htmlAndMathml",
    }),
  });

  visit(tree as never, "element", (node: HNode, index, parent: HNode | null) => {
    if (!parent || index === undefined) return;
    const children = parent.children ?? [];

    if (node.tagName === "pre") {
      const code = node.children?.[0];
      if (code && classesOf(code).includes("math-display")) {
        children[index] = element("div", { className: ["math-block"] }, [
          render(rawText(code), true),
        ]);
        return SKIP;
      }
    } else if (node.tagName === "code" && classesOf(node).includes("math-inline")) {
      // Punctuation stuck to a formula travels with it: a line may not break
      // between "$x$" and the "." after it.
      const wrapped: HNode[] = [render(rawText(node), false)];
      const before = children[index - 1];
      const after = children[index + 1];
      const opener =
        before?.type === "text" ? /[(\u201c\u2018]$/.exec(before.value ?? "") : null;
      if (before && opener) {
        before.value = (before.value ?? "").slice(0, -1);
        wrapped.unshift(text(opener[0]));
      }
      const closer =
        after?.type === "text" ? /^[.,;:!?)\u201d\u2019]+/.exec(after.value ?? "") : null;
      if (after && closer) {
        after.value = (after.value ?? "").slice(closer[0].length);
        wrapped.push(text(closer[0]));
      }
      children[index] =
        wrapped.length === 1
          ? wrapped[0]!
          : element("span", { className: ["nobr"] }, wrapped);
      return SKIP;
    }
  });
}

/** A wide table scrolls inside its own box instead of widening the page. */
function wrapTables(tree: HNode): void {
  visit(tree as never, "element", (node: HNode, index, parent: HNode | null) => {
    if (node.tagName !== "table" || !parent || index === undefined) return;
    (parent.children ?? [])[index] = element("div", { className: ["table-wrap"] }, [
      node,
    ]);
    return SKIP;
  });
}

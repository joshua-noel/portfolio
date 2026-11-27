/**
 * The two passes that run before Markdown does. Lectures are Markdown with
 * four top-level sections and three block-level extensions (see
 * learn-content/CONTRACT.md); this file finds them with a line scanner, so
 * the build-time check can run without loading remark.
 */
import { DEPTHS, type Depth } from "./depth.ts";

export class BlockError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Calls `visit` for each line with whether it is inside a fenced code block. */
function eachLine(
  source: string,
  visit: (line: string, index: number, fenced: boolean) => void,
): void {
  let fence: string | undefined;
  source.split("\n").forEach((line, index) => {
    const match = FENCE.exec(line);
    if (match) {
      const marker = match[1]!;
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
        visit(line, index, true);
        return;
      }
      visit(line, index, true);
      return;
    }
    visit(line, index, fence !== undefined);
  });
}

export interface Section {
  layer: Depth;
  text: string;
  /** 1-based line of the first line of `text`. */
  line: number;
}

const SECTION_NAMES: Record<string, Depth> = {
  Tip: "tip",
  Waterline: "waterline",
  Deep: "deep",
  Abyss: "abyss",
};

/** Splits a lecture body at its four "# Name" lines, which must come in order. */
export function splitSections(body: string, firstLine: number): Section[] {
  const sections: Section[] = [];
  let current: { layer: Depth; lines: string[]; line: number } | undefined;
  const close = (): void => {
    if (current) {
      sections.push({
        layer: current.layer,
        text: current.lines.join("\n"),
        line: current.line,
      });
    }
  };

  eachLine(body, (line, index, fenced) => {
    const lineNo = firstLine + index;
    const heading = !fenced ? /^# (.*?)\s*$/.exec(line) : null;
    if (heading) {
      const layer = SECTION_NAMES[heading[1]!];
      if (layer === undefined) {
        throw new BlockError(
          `"# ${heading[1]}": the only "#" sections are Tip, Waterline, Deep and Abyss`,
          lineNo,
        );
      }
      close();
      current = { layer, lines: [], line: lineNo + 1 };
      return;
    }
    if (current) current.lines.push(line);
    else if (line.trim() !== "") {
      throw new BlockError('text before "# Tip": the body is four "#" sections', lineNo);
    }
  });
  close();

  const found = sections.map((section) => section.layer);
  if (found.join() !== DEPTHS.join()) {
    const missing = DEPTHS.filter((depth) => !found.includes(depth));
    throw new BlockError(
      missing.length > 0
        ? `missing the "# ${missing.map((d) => d[0]!.toUpperCase() + d.slice(1)).join('", "# ')}" section`
        : `the sections must come in the order ${DEPTHS.join(", ")}`,
      firstLine,
    );
  }
  return sections;
}

/** One `## ` section of a version 2 lecture. `text` is what follows the heading line. */
export interface FlatSection {
  /** The heading's own line, as written. */
  heading: string;
  title: string;
  text: string;
  /** 1-based line of the heading. */
  line: number;
}

/**
 * Splits a version 2 body at its `## ` lines. A version 2 lecture has no
 * `# ` headings, and nothing stands before the first `## `.
 */
export function splitSectionsV2(body: string, firstLine: number): FlatSection[] {
  const sections: FlatSection[] = [];
  let current: { heading: string; title: string; lines: string[]; line: number } | undefined;
  const close = (): void => {
    if (current) {
      sections.push({
        heading: current.heading,
        title: current.title,
        text: current.lines.join("\n"),
        line: current.line,
      });
    }
  };
  eachLine(body, (line, index, fenced) => {
    const lineNo = firstLine + index;
    if (!fenced && /^# /.test(line)) {
      throw new BlockError(
        `"${line.trim()}": a version 2 lecture has no "#" headings; its title comes from the front matter and its sections start with "##"`,
        lineNo,
      );
    }
    const heading = !fenced ? /^## (.*?)\s*$/.exec(line) : null;
    if (heading) {
      close();
      current = { heading: line.trimEnd(), title: heading[1]!, lines: [], line: lineNo };
      return;
    }
    if (current) current.lines.push(line);
    else if (line.trim() !== "") {
      throw new BlockError('text before "## In brief": a version 2 lecture is "##" sections', lineNo);
    }
  });
  close();
  return sections;
}

export type Block =
  | { type: "markdown"; text: string; line: number }
  | { type: "diagram"; id: string; caption: string; line: number }
  | { type: "details"; summary: string; body: string; line: number };

const DIAGRAM =
  /^!\[\[diagram:\s*(\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\s*\|\s*(.+?)\s*\]\]\s*$/;
const DISPLAY_MATH = /^\s*\$\$(.+)\$\$\s*$/;
const DETAILS = /^\s*<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*$/;

/**
 * Splits a section into Markdown, diagram lines and <details> blocks. A
 * one-line `$$x$$` becomes a fenced display block here: in remark-math a
 * `$$` that shares its line with the formula is inline maths, which would set
 * every display formula in the text's own line and let it wrap.
 */
export function scanBlocks(text: string, firstLine: number): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let bufferLine = firstLine;
  let details: { lines: string[]; line: number } | undefined;

  const flush = (): void => {
    const joined = buffer.join("\n");
    if (joined.trim() !== "")
      blocks.push({ type: "markdown", text: joined, line: bufferLine });
    buffer = [];
  };

  eachLine(text, (line, index, fenced) => {
    const lineNo = firstLine + index;

    if (details) {
      details.lines.push(line);
      if (line.includes("</details>")) {
        const match = DETAILS.exec(details.lines.join("\n"));
        if (!match) {
          throw new BlockError(
            "a <details> block is <details><summary>Question?</summary>Answer</details>, with nothing after the closing tag",
            details.line,
          );
        }
        blocks.push({
          type: "details",
          summary: match[1]!.trim(),
          body: match[2]!.trim(),
          line: details.line,
        });
        details = undefined;
        bufferLine = lineNo + 1;
      }
      return;
    }

    if (!fenced) {
      if (line.startsWith("![[")) {
        const match = DIAGRAM.exec(line);
        if (!match) {
          throw new BlockError(
            "a diagram line is ![[diagram: NN-name | Caption.]] on a line of its own",
            lineNo,
          );
        }
        flush();
        blocks.push({ type: "diagram", id: match[1]!, caption: match[2]!, line: lineNo });
        bufferLine = lineNo + 1;
        return;
      }
      if (/^\s*<details[\s>]/.test(line)) {
        flush();
        details = { lines: [line], line: lineNo };
        if (line.includes("</details>")) {
          // The whole block is on this one line.
          const match = DETAILS.exec(line);
          if (!match) throw new BlockError("a <details> block needs a <summary>", lineNo);
          blocks.push({
            type: "details",
            summary: match[1]!.trim(),
            body: match[2]!.trim(),
            line: lineNo,
          });
          details = undefined;
          bufferLine = lineNo + 1;
        }
        return;
      }
      const math = DISPLAY_MATH.exec(line);
      if (math && !line.trim().startsWith("$$$")) {
        if (buffer.length === 0) bufferLine = lineNo;
        buffer.push("$$", math[1]!.trim(), "$$");
        return;
      }
    }

    if (buffer.length === 0) bufferLine = lineNo;
    buffer.push(line);
  });

  if (details) throw new BlockError("a <details> block is never closed", details.line);
  flush();
  return blocks;
}

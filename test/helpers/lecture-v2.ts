import type { SourceFile } from "../../src/lib/learn/lecture.ts";

/**
 * A complete, valid version 2 lecture (CONTRACT.md) as data, so a test can
 * change one piece and see the one error that piece causes. Prose is the word
 * "word" repeated: the counter only counts.
 */

export const SVG = `<svg viewBox="0 0 10 10"><title>x</title><desc>y</desc><rect width="5" height="5" fill="var(--c1)" stroke="var(--border)" /></svg>`;

export const DIAGRAMS = new Map([
  ["01-one", SVG],
  ["02-two", SVG],
  ["03-three", SVG],
  ["04-four", SVG],
]);

export const words = (n: number): string =>
  Array.from({ length: n }, () => "word").join(" ");

export const QUESTION = "<details><summary>A question?</summary>An answer.</details>";

const EXPLAIN = (n: number): string =>
  `<details><summary>Prompt ${n}: explain part ${n} to a colleague.</summary>

A good explanation covers:

- The first point.
- The second point.
- The third point.

</details>`;

const INTERVIEW = (n: number): string =>
  `<details><summary>Question ${n}?</summary>

**Model answer.** First this, then that.

**Weak answer.** The common one, and why it is weak.

**Follow-up.** One more question? The answer.

</details>`;

/** One `##` section: its heading line (without `## `) and its body. */
export type Section = [heading: string, body: string];

/** The sections of a valid lecture, in order. */
export function sections(): Section[] {
  return [
    ["In brief", words(200)],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): Section => {
      const figure = n <= 4 ? `\n\n![[diagram: 0${n}-${["one", "two", "three", "four"][n - 1]} | **Fig ${n}.** A caption.]]` : "";
      const cite = n === 1 ? " A citation [Paper]." : "";
      const maths = n === 2 ? "\n\nWith $x^2$ inline." : "";
      return [`${n}. Section ${n}`, `${words(450)}${cite}${maths}${figure}`];
    }),
    ["Worked example", words(120)],
    ["Limits and open questions", words(300)],
    ["In practice", words(300)],
    ["Explain it back", [1, 2, 3].map(EXPLAIN).join("\n\n")],
    ["Interview questions", [1, 2, 3, 4].map(INTERVIEW).join("\n\n")],
    ["Check yourself", Array(5).fill(QUESTION).join("\n\n")],
    ["References", ""],
  ];
}

export const FRONT = `---
format: 2
course: c
order: 1
slug: a-lecture
title: A lecture
promise: What it promises.
visibility: public
video: false
minutes: 28
objectives:
  - One.
  - Two.
  - Three.
prerequisites: []
sources:
  - { id: Paper, title: "A paper", url: "https://example.com/paper", used_for: "everything" }
checked: 2026-11-01
---
`;

/** The lecture as a file. `change` edits the list of sections; `front` replaces the front matter. */
export function lectureV2(
  change: (list: Section[]) => Section[] = (list) => list,
  front: string = FRONT,
): SourceFile {
  const body = change(sections())
    .map(([heading, text]) => `## ${heading}\n\n${text}\n`)
    .join("\n");
  return { path: "01-a-lecture.md", name: "01-a-lecture.md", raw: `${front}\n${body}` };
}

/** Replaces the body of the section called `heading`. */
export const withBody =
  (heading: string, body: string) =>
  (list: Section[]): Section[] =>
    list.map(([h, text]): Section => (h === heading ? [h, body] : [h, text]));

/** Leaves out the section called `heading`. */
export const without =
  (heading: string) =>
  (list: Section[]): Section[] =>
    list.filter(([h]) => h !== heading);

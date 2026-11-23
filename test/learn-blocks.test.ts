import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockError, scanBlocks, splitSections } from "../src/lib/learn/blocks.ts";

const four = "# Tip\nt\n# Waterline\nw\n# Deep\nd\n# Abyss\na\n";

test("a body is four sections, in order, each with its text and first line", () => {
  const sections = splitSections(four, 10);
  assert.deepEqual(
    sections.map((s) => [s.layer, s.text.trim(), s.line]),
    [
      ["tip", "t", 11],
      ["waterline", "w", 13],
      ["deep", "d", 15],
      ["abyss", "a", 17],
    ],
  );
});

test("a missing or misplaced section is named", () => {
  assert.throws(
    () => splitSections("# Tip\nt\n# Waterline\nw\n# Abyss\na", 1),
    /missing the "# Deep"/,
  );
  assert.throws(
    () => splitSections("# Waterline\nw\n# Tip\nt\n# Deep\nd\n# Abyss\na", 1),
    /must come in the order/,
  );
  assert.throws(() => splitSections(`${four}# Extra\nx`, 1), /only "#" sections are Tip/);
  assert.throws(() => splitSections(`words first\n${four}`, 1), /before "# Tip"/);
});

test("a # inside a code fence is code, not a section", () => {
  const body =
    "# Tip\n```python\n# a comment\n```\n# Waterline\nw\n# Deep\nd\n# Abyss\na";
  const sections = splitSections(body, 1);
  assert.equal(sections.length, 4);
  assert.match(sections[0]!.text, /# a comment/);
});

test("a diagram line becomes a diagram block with its caption", () => {
  const blocks = scanBlocks(
    "before\n![[diagram: 03-attention-weights | A caption, with $x$.]]\nafter",
    5,
  );
  assert.deepEqual(blocks, [
    { type: "markdown", text: "before", line: 5 },
    {
      type: "diagram",
      id: "03-attention-weights",
      caption: "A caption, with $x$.",
      line: 6,
    },
    { type: "markdown", text: "after", line: 7 },
  ]);
});

test("a malformed diagram line is an error, not text", () => {
  assert.throws(() => scanBlocks("![[diagram: attention | Caption.]]", 1), BlockError);
  assert.throws(() => scanBlocks("![[diagram: 01-a]]", 1), /on a line of its own/);
});

test("details become a question and an answer, on one line or several", () => {
  const blocks = scanBlocks(
    "<details><summary>Why?</summary>Because.</details>\n\n<details>\n<summary>How $x$?</summary>\n\nLike so.\n\nAnd so.\n</details>",
    1,
  );
  assert.deepEqual(
    blocks.map((b) => b.type === "details" && [b.summary, b.body]),
    [
      ["Why?", "Because."],
      ["How $x$?", "Like so.\n\nAnd so."],
    ],
  );
});

test("details need a summary and a closing tag", () => {
  assert.throws(
    () => scanBlocks("<details>\nno summary\n</details>", 1),
    /<details><summary>/,
  );
  assert.throws(
    () => scanBlocks("<details><summary>Q</summary>never closed", 1),
    /never closed/,
  );
});

test("a one-line $$ formula becomes a display block", () => {
  const [block] = scanBlocks("Before.\n$$a = b$$\nAfter.", 1);
  assert.equal(block?.type, "markdown");
  assert.equal(
    block?.type === "markdown" && block.text,
    "Before.\n$$\na = b\n$$\nAfter.",
  );
});

test("diagrams, details and formulas inside a code fence are left alone", () => {
  const text = "```\n![[diagram: 01-a | x]]\n<details>\n$$a$$\n```";
  const blocks = scanBlocks(text, 1);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type === "markdown" && blocks[0].text, text);
});

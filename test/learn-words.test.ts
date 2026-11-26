import { test } from "node:test";
import assert from "node:assert/strict";
import { proseWords } from "../src/lib/learn/lecture.ts";

test("a backslash-dollar is a dollar sign, so a price is words and the text between two prices is not a formula", () => {
  assert.equal(proseWords("It costs \\$5 and then \\$7 more in total."), 9);
  assert.equal(proseWords("Prices of \\$2.50 per million tokens, and \\$10 for output, are quoted."), 13);
  // Real formulas are still left out, and so are display maths and code.
  assert.equal(proseWords("The cost is $x^2 + y$ for each one."), 6);
  assert.equal(proseWords("A formula $a$ and a price of \\$3 side by side."), 10);
  assert.equal(proseWords("before\n$$\nx = 1\n$$\nafter"), 2);
  assert.equal(proseWords("```\ncode words here\n```\nplain words"), 2);
});

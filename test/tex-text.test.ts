import { test } from "node:test";
import assert from "node:assert/strict";
import { texToText } from "../src/lib/learn/tex-text.ts";

test("a formula reads as plain text: subscripts, superscripts, fractions, roots, symbols", () => {
  const cases: [string, string][] = [
    ["d_{\\text{model}}", "d_model"],
    ["x^2", "x^2"],
    ["x^{n+1}", "x^(n+1)"],
    ["\\frac{a}{b}", "a/b"],
    ["\\frac{n+1}{2}", "(n+1)/2"],
    ["\\sqrt{d_k}", "√(d_k)"],
    ["\\sqrt{n}", "√n"],
    ["\\alpha \\cdot \\beta", "α · β"],
    ["O(n^2 \\log n)", "O(n^2 log n)"],
    ["\\mathrm{softmax}(QK^T / \\sqrt{d})", "softmax(QK^T / √d)"],
    ["a \\leq b \\neq c", "a ≤ b ≠ c"],
    ["\\left( x \\right)", "( x )"],
    ["\\unknown{x}", "unknownx"],
  ];
  for (const [tex, text] of cases) assert.equal(texToText(tex), text, tex);
  assert.equal(texToText(""), "");
});

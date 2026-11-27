import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INTERACTIVE_MODULES,
  SAMPLE_MODULES,
  interactiveProblems,
} from "../src/lib/learn/interactive.ts";
import { suspectMaths } from "../src/lib/learn/render.ts";

const svg = (name?: string) =>
  `<svg viewBox="0 0 10 10"${name ? ` data-interactive="${name}"` : ""}><title>t</title></svg>`;

test("the module table lists exactly the modules the site has", () => {
  const dir = fileURLToPath(new URL("../src/scripts/learn-diagrams", import.meta.url));
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".js") && name !== "controls.js")
    .map((name) => name.replace(/\.js$/, ""))
    .sort();
  const listed = [...INTERACTIVE_MODULES, ...SAMPLE_MODULES].map((m) => m.name).sort();
  assert.deepEqual(listed, files);
});

test("a course that declares all its modules has no problem", () => {
  const diagrams = new Map(
    INTERACTIVE_MODULES.filter((m) => m.course === "system-design").map((m) => [
      m.diagram,
      svg(m.name),
    ]),
  );
  assert.deepEqual(interactiveProblems("system-design", diagrams, false), []);
});

test("a dropped data-interactive is an error that names the module and the file", () => {
  const diagrams = new Map([
    ["05-partition-sides", svg("partition-sides")],
    ["06-retry-policies", svg()],
  ]);
  const problems = interactiveProblems("system-design", diagrams, false);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /"retry-policies" is declared by no diagram/);
  assert.match(problems[0]!, /diagrams\/06-retry-policies\.svg/);
});

test("a module declared twice, or by the wrong diagram, is an error", () => {
  const twice = new Map([
    ["05-partition-sides", svg("partition-sides")],
    ["09-copy", svg("partition-sides")],
    ["06-retry-policies", svg("retry-policies")],
  ]);
  assert.match(interactiveProblems("system-design", twice, false).join("\n"), /declared by 2 diagrams/);
  const wrong = new Map([
    ["05-partition-sides", svg("partition-sides")],
    ["07-other", svg("retry-policies")],
  ]);
  assert.match(
    interactiveProblems("system-design", wrong, false).join("\n"),
    /declared by diagrams\/07-other\.svg; it should be diagrams\/06-retry-policies\.svg/,
  );
});

test("a name that is not a module is an error, in any course", () => {
  const problems = interactiveProblems("a-new-course", new Map([["01-x", svg("flux-capacitor")]]), false);
  assert.match(problems.join("\n"), /"flux-capacitor" is not an interactive module/);
});

test("a course the table does not know owes nothing; the sample owes its own modules", () => {
  assert.deepEqual(interactiveProblems("a-new-course", new Map(), false), []);
  assert.deepEqual(interactiveProblems("how-language-models-work", new Map(), true).length, 3);
});

test("maths that swallowed prose is found, with its line", () => {
  const bad = "First line.\n\nPrice is $2.50 per GPU-hour. Then more words here, so it costs $0.25$ each.\n";
  const found = suspectMaths(bad, 10);
  assert.equal(found.length, 1);
  assert.match(found[0]!, /^line 12: inline maths holds ordinary words/);
  assert.match(found[0]!, /\\\$2\.50/);
});

test("a bare price whose words are short is found too, and real maths is not", () => {
  assert.equal(suspectMaths("It cost $202,000 at $2 each.", 1).length, 1);
  const fine =
    "Then $x = 2 \\times 3$ and $\\text{cost per token} = \\frac{a}{b}$ and $\\operatorname{softmax}(z)$ and \\$2.50 per hour.\n";
  assert.deepEqual(suspectMaths(fine, 1), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONDITIONS, exposure, providers, TOOLS as TOOL_TABLE } from "../src/scripts/learn-diagrams/trifecta.js";

const TOOLS: Record<string, string[]> = TOOL_TABLE;

// The lecture's rule: theft needs all three conditions at once; remove one and it closes.
// Its worked example counts exposed tool subsets (34 of 63), which the same rule must give.
const flags = (private_: boolean, untrusted: boolean, external: boolean) => ({ private: private_, untrusted, external });

test("trifecta: all three present is exposed, as the static diagram says", () => {
  assert.deepEqual(exposure(flags(true, true, true)), { exposed: true, missing: [] });
});

test("trifecta: removing any one or more conditions closes it", () => {
  assert.deepEqual(exposure(flags(false, true, true)), { exposed: false, missing: ["private"] });
  assert.deepEqual(exposure(flags(true, false, true)), { exposed: false, missing: ["untrusted"] });
  assert.deepEqual(exposure(flags(true, true, false)), { exposed: false, missing: ["external"] });
  assert.deepEqual(exposure(flags(false, false, true)).missing, ["private", "untrusted"]);
  assert.deepEqual(exposure(flags(false, false, false)).missing, ["private", "untrusted", "external"]);
  let exposedCount = 0;
  for (let bits = 0; bits < 8; bits++) {
    const on = flags(!!(bits & 1), !!(bits & 2), !!(bits & 4));
    if (exposure(on).exposed) exposedCount++;
  }
  assert.equal(exposedCount, 1);
});

test("trifecta: the lecture's six-tool example gives 34 exposed subsets of 63", () => {
  const tools = Object.keys(TOOLS);
  let exposed = 0, total = 0;
  for (let mask = 1; mask < 1 << tools.length; mask++) {
    const chosen = tools.filter((_, i) => mask & (1 << i));
    const on = Object.fromEntries(CONDITIONS.map((c) => [c.id, chosen.some((t) => TOOLS[t].includes(c.id))]));
    total++;
    if (exposure(on).exposed) exposed++;
  }
  assert.deepEqual([exposed, total], [34, 63]);
  // With all six tools, removing any single tool leaves the agent exposed.
  for (const gone of tools) {
    const rest = tools.filter((t) => t !== gone);
    const on = Object.fromEntries(CONDITIONS.map((c) => [c.id, rest.some((t) => TOOLS[t].includes(c.id))]));
    assert.equal(exposure(on).exposed, true, gone);
  }
});

test("trifecta: the tools that provide each leg, as the lecture lists them", () => {
  assert.deepEqual(providers("private"), ["read_inbox", "read_files"]);
  assert.deepEqual(providers("untrusted"), ["read_inbox", "search_web", "read_issues"]);
  assert.deepEqual(providers("external"), ["search_web", "send_email"]);
});

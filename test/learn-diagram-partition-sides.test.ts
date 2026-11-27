import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, lastSeat, majority, partition, writeQuorum } from "../src/scripts/learn-diagrams/partition-sides.js";

const run = (over: Record<string, unknown> = {}) => partition({ ...DEFAULTS, ...over });

test("partition sides: the worked example, as printed in the lecture (3 replicas, 2 versus 1)", () => {
  const p = run();
  assert.equal(p.w, 2);
  assert.equal(p.majority, 2);
  assert.deepEqual([p.left.size, p.left.commits, p.left.isMajority], [2, true, true]);
  assert.deepEqual([p.right.size, p.right.commits, p.right.isMajority], [1, false, false]);
  assert.equal(p.both, false);
  // "100 buy attempts: 60 reach the 2-node side, 40 reach the 1-node side. With W = 2 ... 40 get a refusal."
  assert.deepEqual(lastSeat(p, DEFAULTS.attempts), { toLeft: 60, toRight: 40, refused: 40, heldTwice: false });
  // "With W = 1 both sides accept a hold for the same seat, so one seat is held twice."
  const one = run({ rule: "one" });
  assert.equal(one.w, 1);
  assert.equal(one.both, true);
  assert.deepEqual(lastSeat(one, 60), { toLeft: 60, toRight: 40, refused: 0, heldTwice: true });
});

test("partition sides: the lecture's majority arithmetic", () => {
  assert.equal(majority(3), 2);
  assert.equal(majority(5), 3); // five tolerate two failures
  assert.equal(majority(6), 4); // the sixth replica raises the quorum
  assert.equal(writeQuorum(5, "all"), 5);
  assert.equal(writeQuorum(5, "one"), 1);
});

// Expected flags come from enumerating, in Python, every W-subset of the N replicas and asking
// whether one lies inside the side: "L" left commits, "R" right commits, one pair per split
// of 0..N replicas on the left. Any two majorities were also checked to share a member.
const TABLE: Record<string, string> = {
  "2/majority": "-R -- L-", "2/one": "-R LR L-", "2/all": "-R -- L-",
  "3/majority": "-R -R L- L-", "3/one": "-R LR LR L-", "3/all": "-R -- -- L-",
  "4/majority": "-R -R -- L- L-", "4/one": "-R LR LR LR L-", "4/all": "-R -- -- -- L-",
  "5/majority": "-R -R -R L- L- L-", "5/one": "-R LR LR LR LR L-", "5/all": "-R -- -- -- -- L-",
  "6/majority": "-R -R -R -- L- L- L-", "6/one": "-R LR LR LR LR LR L-", "6/all": "-R -- -- -- -- -- L-",
  "7/majority": "-R -R -R -R L- L- L- L-", "7/one": "-R LR LR LR LR LR LR L-", "7/all": "-R -- -- -- -- -- -- L-",
};

test("partition sides: every N, rule and split agrees with the enumeration", () => {
  for (const [key, flags] of Object.entries(TABLE)) {
    const [n, rule] = key.split("/");
    const got = flags.split(" ").map((_, left) => {
      const p = partition({ n: Number(n), left, rule });
      return (p.left.commits ? "L" : "-") + (p.right.commits ? "R" : "-");
    });
    assert.equal(got.join(" "), flags, key);
  }
});

test("partition sides: a majority quorum never lets both sides commit", () => {
  for (let n = 2; n <= 7; n++) {
    for (let left = 0; left <= n; left++) assert.equal(partition({ n, left, rule: "majority" }).both, false);
  }
  assert.equal(run({ n: 4, left: 2 }).neither, true); // 2 versus 2 of 4: majority is 3
});

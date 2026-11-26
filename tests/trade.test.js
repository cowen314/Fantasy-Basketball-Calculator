// Run with: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { valueOf, teamTotals, tradeDelta, categoryWeights, suggest } = require("../site/trade.js");

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const closeAll = (a, b) => { assert.equal(a.length, b.length); a.forEach((v, i) => close(v, b[i])); };
const P = (id, z, extra = {}) => ({ id, season: { z, value: z.reduce((a, b) => a + b, 0), g: 10 }, ...extra });

test("teamTotals sums z-scores and skips players without the window", () => {
  const t = teamTotals([P("a", [1, 2, -1]), P("b", [0.5, null, 1]), { id: "c" }], "season", 3);
  closeAll(t.z, [1.5, 2, 0]);
  close(t.value, 3.5);
  assert.equal(t.count, 2);
});

test("tradeDelta is incoming minus outgoing", () => {
  const d = tradeDelta([P("a", [1, 1, 1])], [P("b", [2, 0, 1]), P("c", [0, 1, -1])], "season", 3);
  closeAll(d.z, [1, 0, -1]);
  close(d.value, 0);
  assert.equal(d.countIn, 2);
  assert.equal(d.countOut, 1);
});

test("tradeDelta with nothing traded is zero", () => {
  const d = tradeDelta([], [], "season", 2);
  closeAll(d.z, [0, 0]);
  close(d.value, 0);
});

test("categoryWeights favour weak categories", () => {
  const w = categoryWeights([-4, 0, 4]);
  closeAll(w, [1.75, 1, 0.25]);
  closeAll(categoryWeights([2, 2]), [1, 1]);
});

test("suggest respects value tolerance, needs positive gain, ranks by weighted gain", () => {
  const mine = [P("m", [2, 0])];               // value 2
  const cands = [
    P("fair_helps_weak", [0, 2]),              // value 2, swaps cat 0 for cat 1
    P("fair_helps_strong", [3, -1]),           // value 2, more of cat 0
    P("too_good", [3, 3]),                     // value 6, outside tolerance
    P("worse", [1, 0]),                        // value 1, gain negative
  ];
  const weights = [0.25, 1.75];                // weak in cat 1
  const s = suggest(mine, cands, "season", { tolerance: 1, weights });
  assert.deepEqual(s.map((x) => x.get.id), ["fair_helps_weak"]);
  closeAll(s[0].delta, [-2, 2]);
  close(s[0].gain, -2 * 0.25 + 2 * 1.75);
  close(s[0].valueDiff, 0);

  const flat = suggest(mine, cands, "season", { tolerance: 10 });
  assert.deepEqual(flat.map((x) => x.get.id), ["too_good"]);
});

test("suggest caps ideas per outgoing player", () => {
  const mine = [P("m1", [1, 0]), P("m2", [0.9, 0])];
  const cands = [P("a", [0, 1.5]), P("b", [0, 1.4]), P("c", [0, 1.3])];
  const s = suggest(mine, cands, "season", { weights: [0.25, 1.75], perPlayer: 2 });
  assert.deepEqual(s.map((x) => x.give.id + ">" + x.get.id), ["m2>a", "m1>a", "m2>b", "m1>b"]);
});

// ---- Punting ----
const ACT = [true, false, true];   // punt category 1

test("valueOf skips punted categories and nulls", () => {
  close(valueOf([1, 5, null], ACT), 1);
  close(valueOf([1, 5, 2]), 8);
});

test("teamTotals keeps punted z totals but leaves them out of value", () => {
  const t = teamTotals([P("a", [1, 2, -1]), P("b", [0.5, 3, 1])], "season", 3, ACT);
  closeAll(t.z, [1.5, 5, 0]);
  close(t.value, 1.5);
});

test("tradeDelta value ignores punted categories", () => {
  const d = tradeDelta([P("a", [1, 3, 1])], [P("b", [2, 0, 1])], "season", 3, ACT);
  closeAll(d.z, [1, -3, 0]);
  close(d.value, 1);
});

test("categoryWeights gives punted categories 0 and rescales the rest", () => {
  // Category 1 is by far the weakest but punted, so it doesn't stretch the spread.
  closeAll(categoryWeights([-2, -10, 2], ACT), [1.75, 0, 0.25]);
  closeAll(categoryWeights([3, -10, 3], ACT), [1, 0, 1]);
  closeAll(categoryWeights([1, 2], [false, false]), [0, 0]);
});

test("suggest with a punted category: gain ignores it, fairness uses full value", () => {
  const mine = [P("m", [1, 2, 0])];                        // full value 3
  const cands = [
    P("shooter", [0, 3, 0]),                               // only helps the punted cat
    P("fair", [1, -1, 3]),                                 // full value 3, gives up punted cat
    P("cheap_by_my_count", [1, -6, 2]),                    // full value -3: unfair to them
  ];
  const s = suggest(mine, cands, "season", { tolerance: 1, weights: [1, 0, 1] });
  assert.deepEqual(s.map((x) => x.get.id), ["fair"]);
  close(s[0].gain, 3);
  close(s[0].valueDiff, 0);
});

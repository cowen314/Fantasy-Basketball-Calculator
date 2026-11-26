// Run with: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { teamTotals, tradeDelta, categoryWeights, suggest } = require("../site/trade.js");

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

// Team totals, trade deltas and trade suggestions. Pure functions over the
// player records in players.json, so they can be tested in Node.
"use strict";

(function (root) {
  const zeros = (n) => new Array(n).fill(0);

  // `active` is an optional array of booleans, one per category; false means
  // the category is punted and left out of value. Omitted means all count.
  const counts = (active, i) => !active || active[i];

  // Value of a z-score row over the active categories.
  function valueOf(z, active) {
    return z.reduce((a, v, i) => (counts(active, i) ? a + (v ?? 0) : a), 0);
  }

  // Sum of per-game z-scores across players for one window. Players with no
  // games in the window add nothing; `count` says how many had games. Punted
  // categories still get their z totals (so they can be shown) but add
  // nothing to value.
  function teamTotals(players, win, ncats, active) {
    const z = zeros(ncats);
    let count = 0;
    for (const p of players) {
      const w = p[win];
      if (!w) continue;
      count++;
      w.z.forEach((v, i) => { z[i] += v ?? 0; });
    }
    return { z, value: valueOf(z, active), count };
  }

  // Change to my team's totals from giving `give` and getting `get`.
  function tradeDelta(give, get, win, ncats, active) {
    const out = teamTotals(get, win, ncats, active);
    const lose = teamTotals(give, win, ncats, active);
    return {
      z: out.z.map((v, i) => v - lose.z[i]),
      value: out.value - lose.value,
      countIn: out.count,
      countOut: lose.count,
    };
  }

  // Weight each category by how weak my team is in it compared with my own
  // average category. Weakest gets 1.75, strongest 0.25, average 1. Punted
  // categories get 0 and don't count toward the average or the spread.
  function categoryWeights(totalsZ, active) {
    const idx = totalsZ.map((_, i) => i).filter((i) => counts(active, i));
    const w = zeros(totalsZ.length);
    if (!idx.length) return w;
    const mean = idx.reduce((a, i) => a + totalsZ[i], 0) / idx.length;
    const spread = Math.max(...idx.map((i) => Math.abs(totalsZ[i] - mean)));
    for (const i of idx) w[i] = spread ? 1 - 0.75 * ((totalsZ[i] - mean) / spread) : 1;
    return w;
  }

  // 1-for-1 trade ideas. A trade qualifies when the two players' values are
  // within `tolerance` of each other (roughly fair to the other manager) and
  // the weighted category gain for my team is positive. Ranked by that gain.
  // The fairness check uses each player's full value over all categories,
  // since the other manager isn't punting what I punt; give punted
  // categories a weight of 0 to leave them out of the gain.
  function suggest(mine, candidates, win, opts = {}) {
    const { tolerance = 1, limit = 20, perPlayer = Infinity, weights } = opts;
    const out = [];
    for (const give of mine) {
      const g = give[win];
      if (!g || g.value === null) continue;
      for (const get of candidates) {
        const r = get[win];
        if (!r || r.value === null) continue;
        const valueDiff = r.value - g.value;
        if (Math.abs(valueDiff) > tolerance) continue;
        const delta = r.z.map((v, i) => (v ?? 0) - (g.z[i] ?? 0));
        const gain = delta.reduce((a, d, i) => a + d * (weights ? weights[i] : 1), 0);
        if (gain <= 0) continue;
        out.push({ give, get, delta, valueDiff, gain });
      }
    }
    out.sort((a, b) => b.gain - a.gain);
    // Cap ideas per player I'd give up, so one player doesn't fill the list.
    const used = new Map();
    return out.filter((x) => {
      const n = used.get(x.give.id) || 0;
      if (n >= perPlayer) return false;
      used.set(x.give.id, n + 1);
      return true;
    }).slice(0, limit);
  }

  const api = { valueOf, teamTotals, tradeDelta, categoryWeights, suggest };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Trade = api;
})(this);

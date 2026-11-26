// Team totals, trade deltas and trade suggestions. Pure functions over the
// player records in players.json, so they can be tested in Node.
"use strict";

(function (root) {
  const zeros = (n) => new Array(n).fill(0);

  // Sum of per-game z-scores across players for one window. Players with no
  // games in the window add nothing; `count` says how many had games.
  function teamTotals(players, win, ncats) {
    const z = zeros(ncats);
    let value = 0, count = 0;
    for (const p of players) {
      const w = p[win];
      if (!w) continue;
      count++;
      w.z.forEach((v, i) => { z[i] += v ?? 0; });
      value += w.value ?? 0;
    }
    return { z, value, count };
  }

  // Change to my team's totals from giving `give` and getting `get`.
  function tradeDelta(give, get, win, ncats) {
    const out = teamTotals(get, win, ncats);
    const lose = teamTotals(give, win, ncats);
    return {
      z: out.z.map((v, i) => v - lose.z[i]),
      value: out.value - lose.value,
      countIn: out.count,
      countOut: lose.count,
    };
  }

  // Weight each category by how weak my team is in it compared with my own
  // average category. Weakest gets 1.75, strongest 0.25, average 1.
  function categoryWeights(totalsZ) {
    const n = totalsZ.length;
    if (!n) return [];
    const mean = totalsZ.reduce((a, b) => a + b, 0) / n;
    const dev = totalsZ.map((t) => t - mean);
    const spread = Math.max(...dev.map(Math.abs));
    if (!spread) return zeros(n).map(() => 1);
    return dev.map((d) => 1 - 0.75 * (d / spread));
  }

  // 1-for-1 trade ideas. A trade qualifies when the two players' values are
  // within `tolerance` of each other (roughly fair to the other manager) and
  // the weighted category gain for my team is positive. Ranked by that gain.
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

  const api = { teamTotals, tradeDelta, categoryWeights, suggest };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Trade = api;
})(this);

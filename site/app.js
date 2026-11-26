"use strict";

const $ = (id) => document.getElementById(id);
const state = { sort: "season.value", dir: -1, open: new Set(), give: [], get: [] };
let DATA = null;
let BY_ID = new Map();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let SCALES = {};

const SHORT = { season: "Season", recent: "Last 7", prior: "Prior" };

function fmt(v, digits = 2) {
  if (v === null || v === undefined) return "–";
  const s = v.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

function getVal(p, key) {
  const [w, field, idx] = key.split(".");
  if (w === "name") return p.name;
  const win = p[w];
  if (!win) return null;
  if (field === "z") return win.z[+idx];
  return win[field];
}

function shade(v, scale) {
  if (v === null || v === undefined || !scale) return "";
  const a = Math.min(Math.abs(v) / scale, 1) * 0.38;
  const rgb = v >= 0 ? "var(--pos)" : "var(--neg)";
  return `background: rgba(${rgb}, ${a.toFixed(3)})`;
}

function computeScales() {
  // 90th percentile of |x| per column, so a few outliers don't wash out colors.
  const keys = [];
  for (const w of DATA.meta.windows) {
    keys.push(`${w.key}.value`, `${w.key}.total`);
    DATA.meta.categories.forEach((_, i) => keys.push(`${w.key}.z.${i}`));
  }
  for (const k of keys) {
    const vals = DATA.players.map((p) => getVal(p, k)).filter((v) => v !== null).map(Math.abs).sort((a, b) => a - b);
    SCALES[k] = vals.length ? vals[Math.floor(vals.length * 0.9)] || 1 : 1;
  }
}

function columns() {
  const cats = DATA.meta.categories;
  const d = $("detail").value;
  const cols = [];
  for (const w of DATA.meta.windows) {
    cols.push({ key: `${w.key}.g`, label: "G", group: w.key, first: true, digits: 0 });
    cols.push({ key: `${w.key}.value`, label: "Value", group: w.key, shade: true, strong: true });
    cols.push({ key: `${w.key}.total`, label: "Total", group: w.key, shade: true, digits: 0 });
  }
  cats.forEach((c, i) => cols.push({ key: `${d}.z.${i}`, label: c, group: "cats", first: i === 0, shade: true }));
  return cols;
}

function renderHead() {
  const cols = columns();
  const d = $("detail").value;
  const detailLabel = DATA.meta.windows.find((w) => w.key === d).label;
  const groups = [...DATA.meta.windows.map((w) => ({ key: w.key, label: w.label, n: 3 })),
                  { key: "cats", label: `z-scores: ${detailLabel}`, n: DATA.meta.categories.length }];
  const sortCls = (k) => (state.sort === k ? " sorted" : "");
  const arrow = (k) => (state.sort === k ? (state.dir < 0 ? " ↓" : " ↑") : "");
  $("tbl").tHead.innerHTML =
    `<tr><th class="player group"></th>${groups.map((g) => `<th class="group sep" colspan="${g.n}">${g.label}</th>`).join("")}</tr>` +
    `<tr><th class="player${sortCls("name")}" data-key="name">Player${arrow("name")}</th>` +
    cols.map((c) => `<th class="${c.first ? "sep" : ""}${sortCls(c.key)}" data-key="${c.key}">${c.label}${arrow(c.key)}</th>`).join("") +
    `</tr>`;
}

function filtered() {
  const q = $("search").value.trim().toLowerCase();
  const team = $("team").value;
  const pos = $("pos").value;
  const minG = +$("minG").value || 0;
  const hidePool = $("hidePool").checked;
  const onlyMine = $("onlyMine").checked;
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const qn = norm(q);
  return DATA.players.filter((p) => {
    if (qn && !norm(p.name).includes(qn)) return false;
    if (team && p.team !== team) return false;
    if (pos && !p.pos.split("-").includes(pos)) return false;
    if (minG && (!p.season || p.season.g < minG)) return false;
    if (hidePool && p.rostered && !p.mine) return false;
    if (onlyMine && !p.mine) return false;
    return true;
  });
}

function sorted(rows) {
  const k = state.sort, dir = state.dir;
  return rows.slice().sort((a, b) => {
    const va = getVal(a, k), vb = getVal(b, k);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // missing always last
    if (vb === null) return -1;
    if (typeof va === "string") return dir * va.localeCompare(vb);
    return dir * (va - vb);
  });
}

function statLine(p) {
  const s = DATA.meta.stat_cols;
  const lines = DATA.meta.windows.map((w) => {
    const win = p[w.key];
    if (!win) return `<b>${w.label}</b><span class="muted">no games</span>`;
    const v = Object.fromEntries(s.map((c, i) => [c, win.stats[i]]));
    const pct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, "") : "–");
    return `<b>${w.label}</b><span>${win.g} G · ${v.pts.toFixed(1)} pts · ${v.reb.toFixed(1)} reb · ${v.ast.toFixed(1)} ast · ` +
      `${v.stl.toFixed(1)} stl · ${v.blk.toFixed(1)} blk · ${v.fg3m.toFixed(1)} 3pm · ${v.tov.toFixed(1)} to · ` +
      `FG ${pct(v.fgm, v.fga)} on ${v.fga.toFixed(1)} · FT ${pct(v.ftm, v.fta)} on ${v.fta.toFixed(1)} · rank #${win.rank}</span>`;
  });
  return `<div class="statline">${lines.join("")}</div>`;
}

function renderBody() {
  const cols = columns();
  const rows = sorted(filtered());
  const html = [];
  for (const p of rows) {
    const inPool = p.season && p.season.pool;
    const inTrade = state.give.includes(p.id) || state.get.includes(p.id);
    const btn = `<button type="button" class="tr-btn${inTrade ? " on" : ""}" data-trade="${p.id}" ` +
      `title="${inTrade ? "Remove from trade" : p.mine ? "Add to give side" : "Add to get side"}">⇄</button>`;
    html.push(`<tr class="main${p.mine ? " mine" : ""}" data-id="${p.id}"><td class="player" title="${p.name}">${btn}` +
      `${p.mine ? '<span class="star" title="On my team">★</span>' : ""}${p.name}${p.il ? '<span class="il" title="On my IL, not counted in team totals">IL</span>' : ""}` +
      `<span class="sub">${p.team}${p.pos ? " · " + p.pos : ""}</span>${inPool ? '<span class="dot" title="In the season-to-date baseline pool"></span>' : ""}</td>`);
    for (const c of cols) {
      const v = getVal(p, c.key);
      const cls = [c.first ? "sep" : "", v === null ? "na" : "", c.strong ? "strong" : ""].join(" ").trim();
      const style = c.shade ? shade(v, SCALES[c.key]) : "";
      html.push(`<td class="${cls}" style="${style}">${fmt(v, c.digits ?? 2)}</td>`);
    }
    html.push("</tr>");
    if (state.open.has(p.id)) {
      html.push(`<tr class="detail"><td colspan="${cols.length + 1}">${statLine(p)}</td></tr>`);
    }
  }
  $("tbl").tBodies[0].innerHTML = html.join("");
  $("count").textContent = `${rows.length} of ${DATA.players.length} players`;
}

function render() {
  renderHead();
  renderBody();
}

// ---- My team, trade builder, trade ideas ----

const cats = () => DATA.meta.categories;
const myPlayers = () => DATA.meta.my_team.ids.map((id) => BY_ID.get(id)).filter(Boolean);
// Players counted in team totals: my roster minus the injured list.
const myActive = () => myPlayers().filter((p) => !p.il);
const signed = (v, d = 2) => (v > 0 ? "+" : "") + fmt(v, d);

function totalsScale(values) {
  return Math.max(...values.map((v) => Math.abs(v ?? 0)), 0.01);
}

function catCells(values, scale, digits = 2, sign = false) {
  return values.map((v) => `<td style="${shade(v, scale)}">${sign ? signed(v, digits) : fmt(v, digits)}</td>`).join("");
}

function headRow(first, extra = []) {
  return `<tr><th>${first}</th>${cats().map((c) => `<th>${c}</th>`).join("")}<th>Value</th>${extra.map((e) => `<th>${e}</th>`).join("")}</tr>`;
}

function renderTeam() {
  const team = DATA.meta.my_team;
  const mine = myActive();
  $("team-panel").hidden = !team.ids.length && !team.unmatched.length;
  $("onlyMineWrap").hidden = !team.ids.length;
  $("suggest-panel").hidden = !team.ids.length;
  $("team-name").textContent = team.name;
  const nIl = team.ids.length - mine.length;
  $("team-note").textContent = `${mine.length} active${nIl ? ` · ${nIl} on IL, not counted in totals` : ""}`;
  $("team-warn").hidden = !team.unmatched.length;
  $("team-warn").textContent = team.unmatched.length ? `Couldn't match: ${team.unmatched.join("; ")}` : "";
  const rows = DATA.meta.windows.map((w) => {
    const t = Trade.teamTotals(mine, w.key, cats().length);
    const scale = totalsScale(t.z);
    return `<tr><td>${w.label} <span class="muted">(${t.count} with games)</span></td>` +
      catCells(t.z, scale, 1) + `<td class="strong">${fmt(t.value, 1)}</td></tr>`;
  });
  $("team-tbl").innerHTML = `<thead>${headRow("Window")}</thead><tbody>${rows.join("")}</tbody>`;
}

function chip(p, side) {
  const v = p.season ? fmt(p.season.value) : "–";
  return `<span class="chip">${p.mine ? '<span class="star">★</span>' : ""}${esc(p.name)}${p.il ? ' <span class="il">IL</span>' : ""} <span class="v">${v}</span>` +
    `<button type="button" data-remove="${p.id}" data-side="${side}" title="Remove">×</button></span>`;
}

function renderTrade() {
  const give = state.give.map((id) => BY_ID.get(id)).filter(Boolean);
  const get = state.get.map((id) => BY_ID.get(id)).filter(Boolean);
  const none = '<span class="muted">Nobody yet</span>';
  $("trade-give").innerHTML = give.length ? give.map((p) => chip(p, "give")).join("") : none;
  $("trade-get").innerHTML = get.length ? get.map((p) => chip(p, "get")).join("") : none;
  $("trade-clear").hidden = !give.length && !get.length;
  $("trade-result").hidden = !give.length && !get.length;
  if (!give.length && !get.length) return;

  const n = cats().length;
  const mine = myActive();
  const hasTeam = mine.length > 0;
  // After the trade: active players I keep, plus everyone I get.
  const kept = mine.filter((p) => !state.give.includes(p.id));
  const rows = [];
  for (const w of DATA.meta.windows) {
    const d = Trade.tradeDelta(give, get, w.key, n);
    const scale = Math.max(totalsScale(d.z), 1);
    rows.push(`<tr class="total"><td>${w.label}: change</td>${catCells(d.z, scale, 2, true)}` +
      `<td style="${shade(d.value, scale)}">${signed(d.value)}</td></tr>`);
    if (hasTeam) {
      const before = Trade.teamTotals(mine, w.key, n);
      const afterT = Trade.teamTotals([...kept, ...get], w.key, n);
      const after = afterT.z;
      const s2 = totalsScale([...before.z, ...after]);
      rows.push(`<tr><td class="muted">&nbsp;&nbsp;team before → after</td>` +
        before.z.map((v, i) => `<td class="muted">${fmt(v, 1)} → <span style="${shade(after[i], s2)}">${fmt(after[i], 1)}</span></td>`).join("") +
        `<td class="muted">${fmt(before.value, 1)} → ${fmt(afterT.value, 1)}</td></tr>`);
    }
  }
  $("trade-tbl").innerHTML = `<thead>${headRow("Per game")}</thead><tbody>${rows.join("")}</tbody>`;
}

function renderSuggestions() {
  if ($("suggest-panel").hidden) return;
  const win = $("sg-window").value;
  const n = cats().length;
  const mine = myPlayers();
  const totals = Trade.teamTotals(myActive(), win, n);
  const weights = Trade.categoryWeights(totals.z);
  $("sg-weights").textContent = "Category weights: " +
    cats().map((c, i) => `${c} ${weights[i].toFixed(2)}×`).join(" · ");

  // Skip tiny samples: need a quarter of the window's most games played.
  const maxG = Math.max(...DATA.players.map((p) => (p[win] ? p[win].g : 0)));
  const minG = Math.max(1, Math.round(DATA.meta.config.min_games_fraction * maxG));
  const onlyRostered = $("sg-targets").value === "rostered";
  const cands = DATA.players.filter((p) => !p.mine && p[win] && p[win].g >= minG && (!onlyRostered || p.rostered));
  const tol = Math.max(0, +$("sg-tol").value || 0);
  const ideas = Trade.suggest(mine, cands, win, { tolerance: tol, weights, limit: 12, perPlayer: 3 });

  if (!ideas.length) {
    $("sg-tbl").innerHTML = `<tbody><tr><td class="muted">No 1-for-1 swaps within a value gap of ${tol}. Try a bigger gap or another window.</td></tr></tbody>`;
    return;
  }
  const scale = Math.max(totalsScale(ideas.flatMap((x) => x.delta)), 1);
  const rows = ideas.map((x) =>
    `<tr><td class="who">${esc(x.give.name)}${x.give.il ? ' <span class="il">IL</span>' : ""} → <b>${esc(x.get.name)}</b> <span class="muted">${x.get.team}</span></td>` +
    catCells(x.delta, scale, 2, true) +
    `<td>${signed(x.valueDiff)}</td><td class="strong">${fmt(x.gain)}</td>` +
    `<td><button type="button" data-try="${x.give.id}|${x.get.id}">Try</button></td></tr>`);
  $("sg-tbl").innerHTML = `<thead>${headRow("Give → get", ["Weighted gain", ""])}</thead><tbody>${rows.join("")}</tbody>`;
}

function saveTrade() {
  store.set("fbc.trade", { give: state.give, get: state.get });
}

function toggleTrade(id) {
  const p = BY_ID.get(id);
  if (!p) return;
  const side = p.mine ? state.give : state.get;
  const i = side.indexOf(id);
  i >= 0 ? side.splice(i, 1) : side.push(id);
  saveTrade();
  renderTrade();
  renderBody();
}

function init(data) {
  DATA = data;
  const m = data.meta;
  m.my_team = m.my_team || { name: "My team", ids: [], unmatched: [] };
  BY_ID = new Map(data.players.map((p) => [p.id, p]));
  const saved = store.get("fbc.trade");
  if (saved) {
    // Drop anyone who left the data or switched sides since the trade was saved.
    state.give = (saved.give || []).filter((id) => BY_ID.get(id)?.mine);
    state.get = (saved.get || []).filter((id) => BY_ID.has(id) && !BY_ID.get(id).mine);
  }
  computeScales();
  const n = m.config.teams * m.config.roster_spots;
  const updated = new Date(m.updated);
  $("meta").textContent =
    `${m.config.teams} teams × ${m.config.roster_spots} spots · ${m.categories.length} categories · ` +
    `last 7 days = ${m.recent_range[0]} to ${m.recent_range[1]} · updated ${updated.toLocaleString()}`;
  $("detail").innerHTML = m.windows.map((w) => `<option value="${w.key}">${w.label}</option>`).join("");
  $("sg-window").innerHTML = $("detail").innerHTML;
  const teams = [...new Set(data.players.map((p) => p.team))].filter((t) => t && !/^\dTM$/.test(t)).sort();
  $("team").insertAdjacentHTML("beforeend", teams.map((t) => `<option>${t}</option>`).join(""));

  for (const id of ["search", "team", "pos", "minG", "hidePool", "onlyMine"]) $(id).addEventListener("input", renderBody);
  for (const id of ["sg-window", "sg-targets", "sg-tol"]) $(id).addEventListener("input", renderSuggestions);
  $("trade-clear").addEventListener("click", () => {
    state.give = []; state.get = [];
    saveTrade(); renderTrade(); renderBody();
  });
  for (const id of ["trade-give", "trade-get"]) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-remove]");
      if (b) toggleTrade(b.dataset.remove);
    });
  }
  $("sg-tbl").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-try]");
    if (!b) return;
    const [give, get] = b.dataset.try.split("|");
    state.give = [give]; state.get = [get];
    saveTrade(); renderTrade(); renderBody();
    $("trade-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("detail").addEventListener("input", () => {
    if (state.sort.includes(".z.")) state.sort = state.sort.replace(/^\w+/, $("detail").value);
    render();
  });
  $("tbl").tHead.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th) return;
    const k = th.dataset.key;
    if (state.sort === k) state.dir = -state.dir;
    else { state.sort = k; state.dir = k === "name" ? 1 : -1; }
    render();
  });
  $("tbl").tBodies[0].addEventListener("click", (e) => {
    const b = e.target.closest("button[data-trade]");
    if (b) { toggleTrade(b.dataset.trade); return; }
    const tr = e.target.closest("tr.main");
    if (!tr) return;
    const id = tr.dataset.id;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    renderBody();
  });
  renderTeam();
  renderTrade();
  renderSuggestions();
  render();
}

fetch("data/players.json")
  .then((r) => r.json())
  .then(init)
  .catch((err) => { $("meta").textContent = `Could not load data: ${err}`; });

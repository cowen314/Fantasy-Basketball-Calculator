"use strict";

const $ = (id) => document.getElementById(id);
const state = { sort: "season.value", dir: -1, open: new Set() };
let DATA = null;
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
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const qn = norm(q);
  return DATA.players.filter((p) => {
    if (qn && !norm(p.name).includes(qn)) return false;
    if (team && p.team !== team) return false;
    if (pos && !p.pos.split("-").includes(pos)) return false;
    if (minG && (!p.season || p.season.g < minG)) return false;
    if (hidePool && p.rostered) return false;
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
    html.push(`<tr class="main" data-id="${p.id}"><td class="player" title="${p.name}">${p.name}` +
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

function init(data) {
  DATA = data;
  const m = data.meta;
  computeScales();
  const n = m.config.teams * m.config.roster_spots;
  const updated = new Date(m.updated);
  $("meta").textContent =
    `${m.config.teams} teams × ${m.config.roster_spots} spots · ${m.categories.length} categories · ` +
    `last 7 days = ${m.recent_range[0]} to ${m.recent_range[1]} · updated ${updated.toLocaleString()}`;
  $("detail").innerHTML = m.windows.map((w) => `<option value="${w.key}">${w.label}</option>`).join("");
  const teams = [...new Set(data.players.map((p) => p.team))].filter((t) => t && !/^\dTM$/.test(t)).sort();
  $("team").insertAdjacentHTML("beforeend", teams.map((t) => `<option>${t}</option>`).join(""));

  for (const id of ["search", "team", "pos", "minG", "hidePool"]) $(id).addEventListener("input", renderBody);
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
    const tr = e.target.closest("tr.main");
    if (!tr) return;
    const id = tr.dataset.id;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    renderBody();
  });
  render();
}

fetch("data/players.json")
  .then((r) => r.json())
  .then(init)
  .catch((err) => { $("meta").textContent = `Could not load data: ${err}`; });

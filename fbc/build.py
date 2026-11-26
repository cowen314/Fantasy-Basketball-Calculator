"""Build the merged valuation table.

    python -m fbc.build [--cache-dir DIR] [--date YYYY-MM-DD] [--rebuild-static]

Writes site/data/players.json (for the web page) and site/data/players.csv.
The prior-season window is computed once and stored in data/static/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import fetch, roster
from .zscores import Baseline, find_baseline, per_game, score

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "data" / "static"
OUT_DIR = ROOT / "site" / "data"
PG_COLS = ["fgm", "fga", "ftm", "fta", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov"]


def season_label(end_year: int) -> str:
    return f"{end_year - 1}-{str(end_year)[2:]}"


def current_season(today: dt.date) -> int:
    """basketball-reference season year (the year the season ends)."""
    return today.year + 1 if today.month >= 9 else today.year


def eligible_mask(pg: pd.DataFrame, fraction: float) -> pd.Series:
    min_games = max(1, round(fraction * pg["g"].max()))
    return pg["g"] >= min_games


def scored_window(pg: pd.DataFrame, cats: list[str], base: Baseline) -> pd.DataFrame:
    z = score(pg, cats, base)
    out = pg[["player_id", "name", "team", "g"] + (["pos"] if "pos" in pg else [])].copy()
    for c in PG_COLS:
        out[c] = pg[c]
    for cat in cats:
        out[f"z_{cat}"] = z[cat]
    out["value"] = z["value"]
    out["total"] = z["value"] * pg["g"]
    out["rank"] = out["value"].rank(ascending=False, method="min").astype(int)
    out["pool"] = pg["player_id"].isin(base.pool_ids)
    return out.set_index("player_id")


def compute_season(end_year: int, cfg: dict, cache_dir: Path | None):
    totals = fetch.season_totals(end_year, cache_dir)
    pg = per_game(totals)
    n = cfg["teams"] * cfg["roster_spots"]
    base = find_baseline(pg, cfg["categories"], n, eligible_mask(pg, cfg["min_games_fraction"]))
    return pg, base, scored_window(pg, cfg["categories"], base)


def static_season(end_year: int, cfg: dict, cache_dir: Path | None, rebuild: bool):
    csv_path = STATIC_DIR / f"{end_year}.csv"
    meta_path = STATIC_DIR / f"{end_year}.json"
    if csv_path.exists() and meta_path.exists() and not rebuild:
        meta = json.loads(meta_path.read_text())
        if meta["config"] == {k: cfg[k] for k in meta["config"]}:
            df = pd.read_csv(csv_path, index_col="player_id", keep_default_na=False,
                             na_values=[""])
            return df, meta["baseline"]
    _, base, df = compute_season(end_year, cfg, cache_dir)
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(csv_path, float_format="%.4f")
    cfg_keys = ["teams", "roster_spots", "categories", "min_games_fraction"]
    meta_path.write_text(json.dumps({
        "config": {k: cfg[k] for k in cfg_keys}, "baseline": base.to_dict(),
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }, indent=2))
    return df, base.to_dict()


def _num(x, digits=2):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return round(float(x), digits)


def window_record(row: pd.Series, cats: list[str]) -> dict:
    return {
        "g": int(row["g"]),
        "z": [_num(row[f"z_{c}"]) for c in cats],
        "value": _num(row["value"]),
        "total": _num(row["total"], 1),
        "rank": int(row["rank"]),
        "pool": bool(row["pool"]),
        "stats": [_num(row[c], 2) for c in PG_COLS],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=ROOT / "config.json")
    ap.add_argument("--team", type=Path, default=ROOT / "my_team.json",
                    help="my hardcoded fantasy roster")
    ap.add_argument("--cache-dir", type=Path, help="cache fetched HTML here")
    ap.add_argument("--date", help="treat this as today (YYYY-MM-DD, US Eastern)")
    ap.add_argument("--rebuild-static", action="store_true")
    args = ap.parse_args(argv)

    cfg = json.loads(args.config.read_text())
    cats = cfg["categories"]
    today = (dt.date.fromisoformat(args.date) if args.date
             else dt.datetime.now(ZoneInfo("America/New_York")).date())
    season = current_season(today)
    static_year = cfg["static_season"]

    print(f"Season {season_label(season)} to date...")
    season_pg, season_base, season_df = compute_season(season, cfg, args.cache_dir)
    print(f"  {len(season_pg)} players, pool of {len(season_base.pool_ids)} "
          f"converged in {season_base.iterations} iterations")

    days = cfg["recent_days"]
    print(f"Last {days} days...")
    recent = fetch.recent_totals(today, days, args.cache_dir)
    recent_pg = per_game(recent)
    if not recent_pg.empty:
        recent_df = scored_window(recent_pg, cats, season_base)  # season baseline on purpose
        recent_df["pool"] = recent_df.index.isin(season_base.pool_ids)
    else:
        recent_df = pd.DataFrame()
    print(f"  {len(recent_pg)} players")

    print(f"{season_label(static_year)} season (static)...")
    static_df, static_base = static_season(static_year, cfg, args.cache_dir, args.rebuild_static)
    print(f"  {len(static_df)} players")

    windows = [
        ("season", f"{season_label(season)} to date", season_df),
        ("recent", f"Last {days} days", recent_df),
        ("prior", f"{season_label(static_year)} season", static_df),
    ]

    # "Likely rostered": in the baseline pool, or top-N by per-game value this
    # season or last season (catches stars below the min-games cutoff, e.g.
    # returning from injury). Used by the page's waiver filter.
    n = cfg["teams"] * cfg["roster_spots"]
    rostered = (set(season_base.pool_ids)
                | set(season_df.index[season_df["rank"] <= n])
                | set(static_df.index[static_df["rank"] <= n]))

    ids = list(dict.fromkeys([*season_df.index, *recent_df.index, *static_df.index]))
    players = []
    for pid in ids:
        rec = {"id": pid, "rostered": pid in rostered}
        for key, _, df in windows:
            if pid in df.index:
                row = df.loc[pid]
                rec.setdefault("name", row["name"])
                rec.setdefault("team", row["team"])
                if "pos" in row and isinstance(row["pos"], str):
                    rec.setdefault("pos", row["pos"])
                rec[key] = window_record(row, cats)
        rec.setdefault("pos", "")
        players.append(rec)

    team = roster.load(args.team)
    names = {p["id"]: p["name"] for p in players}
    active_ids, problems = roster.match(team["players"], names)
    il_ids, il_problems = roster.match(team["il"], names)
    problems += [f"IL: {m}" for m in il_problems]
    il_ids = [i for i in il_ids if i not in active_ids]
    my_ids = active_ids + il_ids
    for p in players:
        if p["id"] in my_ids:
            p["mine"] = True
        if p["id"] in il_ids:
            p["il"] = True
    print(f"My team: matched {len(my_ids)} of {len(team['players']) + len(team['il'])} players "
          f"({len(il_ids)} on IL)")
    for msg in problems:
        print(f"  WARNING: {msg}")

    meta = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "as_of": today.isoformat(),
        "recent_range": [(today - dt.timedelta(days=days)).isoformat(),
                         (today - dt.timedelta(days=1)).isoformat()],
        "config": cfg,
        "categories": cats,
        "stat_cols": PG_COLS,
        "windows": [{"key": k, "label": label} for k, label, _ in windows],
        "baselines": {"season": season_base.to_dict(), "prior": static_base},
        "my_team": {"name": team["name"], "ids": my_ids, "il": il_ids, "unmatched": problems},
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "players.json").write_text(
        json.dumps({"meta": meta, "players": players}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    # Flat CSV: one row per player, columns per window.
    flat = []
    for p in players:
        r = {"player_id": p["id"], "name": p["name"], "team": p["team"], "pos": p["pos"],
             "likely_rostered": p["rostered"], "mine": p.get("mine", False), "il": p.get("il", False)}
        for key, _, _ in windows:
            w = p.get(key)
            r[f"{key}_g"] = w["g"] if w else None
            for i, c in enumerate(cats):
                r[f"{key}_z_{c}"] = w["z"][i] if w else None
            r[f"{key}_value"] = w["value"] if w else None
            r[f"{key}_total"] = w["total"] if w else None
        flat.append(r)
    pd.DataFrame(flat).sort_values("season_value", ascending=False).to_csv(
        OUT_DIR / "players.csv", index=False, encoding="utf-8")
    print(f"Wrote {len(players)} players to {OUT_DIR}")


if __name__ == "__main__":
    main()

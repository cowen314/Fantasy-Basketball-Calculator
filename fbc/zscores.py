"""Z-score valuation for head-to-head category leagues.

For each category, z = (player per-game stat - pool mean) / pool SD.
  * Counting stats: per-game average.
  * FG% / FT%: impact = attempts x (player% - pool%) = makes - pool% x attempts,
    so shot volume counts.
  * TO: z is negated, since fewer is better.
Value = sum of category z-scores (per game).

The pool approximates the players rostered in the league: z-score everyone,
take the top N by value, recompute mean/SD over just those N, and repeat until
the top N stops changing.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# category -> per-game column (counting stats)
COUNTING = {"PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl",
            "BLK": "blk", "3PM": "fg3m", "TO": "tov"}
# category -> (makes, attempts)
PERCENT = {"FG%": ("fgm", "fga"), "FT%": ("ftm", "fta")}
NEGATIVE = {"TO"}
STAT_COLS = ["fgm", "fga", "ftm", "fta", "fg3m", "reb", "ast", "stl", "blk", "tov", "pts"]


@dataclass
class Baseline:
    pct: dict[str, float]          # pool FG% / FT%
    mean: dict[str, float]
    sd: dict[str, float]
    pool_ids: list[str] = field(default_factory=list)
    iterations: int = 0

    def to_dict(self) -> dict:
        return {"pct": self.pct, "mean": self.mean, "sd": self.sd,
                "pool_size": len(self.pool_ids), "iterations": self.iterations}


def per_game(totals: pd.DataFrame) -> pd.DataFrame:
    """Totals -> per-game averages (players with 0 games dropped)."""
    df = totals[totals["g"] > 0].copy()
    for c in STAT_COLS:
        df[c] = df[c] / df["g"]
    return df


def raw_values(pg: pd.DataFrame, categories: list[str], pct: dict[str, float]) -> pd.DataFrame:
    """Per-category raw values before standardising."""
    out = {}
    for cat in categories:
        if cat in COUNTING:
            out[cat] = pg[COUNTING[cat]]
        elif cat in PERCENT:
            makes, att = PERCENT[cat]
            out[cat] = pg[makes] - pct[cat] * pg[att]
        else:
            raise ValueError(f"unknown category {cat!r}")
    return pd.DataFrame(out, index=pg.index)


def baseline_from(pool: pd.DataFrame, categories: list[str]) -> Baseline:
    pct = {cat: (pool[m].sum() / pool[a].sum() if pool[a].sum() > 0 else 0.0)
           for cat, (m, a) in PERCENT.items()}
    raw = raw_values(pool, categories, pct)
    sd = raw.std(ddof=0).replace(0, np.nan)
    return Baseline(pct=pct, mean=raw.mean().to_dict(), sd=sd.to_dict())


def score(pg: pd.DataFrame, categories: list[str], base: Baseline) -> pd.DataFrame:
    """Category z-scores plus 'value' (sum), indexed like pg."""
    raw = raw_values(pg, categories, base.pct)
    z = pd.DataFrame(index=pg.index)
    for cat in categories:
        zc = (raw[cat] - base.mean[cat]) / base.sd[cat]
        z[cat] = -zc if cat in NEGATIVE else zc
    z = z.fillna(0.0)
    z["value"] = z[categories].sum(axis=1)
    return z


def find_baseline(pg: pd.DataFrame, categories: list[str], pool_size: int,
                  eligible: pd.Series, max_iter: int = 50) -> Baseline:
    """Iterate top-N selection until the pool is stable.

    The iteration can settle into a short cycle where a borderline player
    swaps in and out at the N-th spot; any repeated pool counts as stable,
    since the baseline barely moves between the states of such a cycle.
    """
    candidates = pg[eligible]
    pool = candidates
    seen: set[frozenset] = set()
    for i in range(1, max_iter + 1):
        base = baseline_from(pool, categories)
        value = score(candidates, categories, base)["value"]
        top = frozenset(value.nlargest(pool_size).index)
        if top in seen:
            break
        seen.add(top)
        pool = candidates.loc[list(top)]
    base = baseline_from(pool, categories)
    base.pool_ids = pool["player_id"].tolist()
    base.iterations = i
    return base

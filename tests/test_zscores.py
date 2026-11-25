import numpy as np
import pandas as pd
import pytest

from fbc.zscores import baseline_from, find_baseline, per_game, score

CATS = ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"]


def make_totals(n=60, seed=0):
    rng = np.random.default_rng(seed)
    g = rng.integers(1, 20, n).astype(float)
    fga = rng.uniform(2, 20, n) * g
    fta = rng.uniform(0, 8, n) * g
    return pd.DataFrame({
        "player_id": [f"p{i}" for i in range(n)], "name": [f"P{i}" for i in range(n)],
        "g": g, "fga": fga, "fgm": fga * rng.uniform(0.35, 0.6, n),
        "fta": fta, "ftm": fta * rng.uniform(0.5, 0.9, n),
        "fg3m": rng.uniform(0, 4, n) * g, "pts": rng.uniform(2, 30, n) * g,
        "reb": rng.uniform(1, 12, n) * g, "ast": rng.uniform(0, 9, n) * g,
        "stl": rng.uniform(0, 2, n) * g, "blk": rng.uniform(0, 2, n) * g,
        "tov": rng.uniform(0, 4, n) * g,
    })


def test_pool_zscores_are_standardised():
    pg = per_game(make_totals())
    base = baseline_from(pg, CATS)
    z = score(pg, CATS, base)
    for cat in CATS:
        assert z[cat].mean() == pytest.approx(0, abs=1e-9)
        assert z[cat].std(ddof=0) == pytest.approx(1)


def test_percentage_impact_has_zero_mean_in_pool():
    pg = per_game(make_totals())
    base = baseline_from(pg, CATS)
    assert base.mean["FG%"] == pytest.approx(0, abs=1e-9)
    assert base.pct["FG%"] == pytest.approx(pg.fgm.sum() / pg.fga.sum())


def test_turnovers_negated():
    pg = per_game(make_totals())
    z = score(pg, CATS, baseline_from(pg, CATS))
    assert z["TO"].corr(pg["tov"]) == pytest.approx(-1)


def test_volume_matters_for_percentages():
    pg = per_game(make_totals())
    base = baseline_from(pg, CATS)
    # Same FG%, 3x the attempts -> 3x the impact distance from the mean.
    a = pg.iloc[[0]].copy()
    a["fga"] = 10.0; a["fgm"] = 6.0
    b = a.copy(); b["fga"] = 30.0; b["fgm"] = 18.0
    za, zb = score(a, CATS, base)["FG%"].iloc[0], score(b, CATS, base)["FG%"].iloc[0]
    assert zb == pytest.approx(3 * za)


def test_find_baseline_converges_to_top_n():
    pg = per_game(make_totals(200))
    eligible = pd.Series(True, index=pg.index)
    base = find_baseline(pg, CATS, 50, eligible)
    assert len(base.pool_ids) == 50
    value = score(pg, CATS, base)["value"]
    top = set(pg.loc[value.nlargest(50).index, "player_id"])
    assert top == set(base.pool_ids)

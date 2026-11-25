"""Fetch NBA player stats from basketball-reference.com.

stats.nba.com blocks most cloud/CI IP ranges, so basketball-reference is the
source. Requests honour HTTPS_PROXY if it is set, for environments where
basketball-reference is blocked too.

Every function returns *totals* with standard columns:
    player_id, name, team, pos, g, fgm, fga, ftm, fta, fg3m, reb, ast, stl, blk, tov, pts
"""
from __future__ import annotations

import datetime as dt
import time
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

BASE = "https://www.basketball-reference.com"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0 Safari/537.36"
)
# basketball-reference bans clients that exceed ~20 requests/minute.
REQUEST_INTERVAL = 3.5

STAT_MAP = {
    "fg": "fgm", "fga": "fga", "ft": "ftm", "fta": "fta", "fg3": "fg3m",
    "trb": "reb", "ast": "ast", "stl": "stl", "blk": "blk", "tov": "tov", "pts": "pts",
}
STAT_COLS = list(STAT_MAP.values())

_last_request = 0.0


def _get(url: str, cache_dir: Path | None = None, cache_key: str | None = None) -> str:
    global _last_request
    if cache_dir and cache_key:
        path = cache_dir / cache_key
        if path.exists():
            return path.read_text(encoding="utf-8")
    wait = REQUEST_INTERVAL - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    for attempt in range(4):
        _last_request = time.monotonic()
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            if resp.status_code == 429:
                raise requests.HTTPError("429 rate limited", response=resp)
            resp.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    # basketball-reference sends no charset header, so requests would guess
    # ISO-8859-1 and garble accented names (Jokić -> JokiÄ). Pages are UTF-8.
    html = resp.content.decode("utf-8", errors="replace")
    if cache_dir and cache_key:
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / cache_key).write_text(html, encoding="utf-8")
    return html


def _num(text: str) -> float:
    text = text.strip()
    return float(text) if text else 0.0


def _rows(html: str, table_id: str):
    """Yield (row_classes, {data-stat: cell}) for body rows of a table."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id=table_id)
    if table is None:
        # Some tables are shipped inside HTML comments.
        for comment in soup.find_all(string=lambda s: isinstance(s, str) and f'id="{table_id}"' in s):
            table = BeautifulSoup(comment, "lxml").find("table", id=table_id)
            if table is not None:
                break
    if table is None:
        raise ValueError(f"table {table_id!r} not found")
    for tr in table.tbody.find_all("tr"):
        cells = {c.get("data-stat"): c for c in tr.find_all(["th", "td"])}
        yield tr.get("class") or [], cells


def season_totals(end_year: int, cache_dir: Path | None = None) -> pd.DataFrame:
    """Season totals, one row per player (traded players combined)."""
    url = f"{BASE}/leagues/NBA_{end_year}_totals.html"
    html = _get(url, cache_dir, f"totals_{end_year}.html")
    players: dict[str, dict] = {}
    for classes, cells in _rows(html, "totals_stats"):
        name_cell = cells.get("name_display")
        if name_cell is None or not name_cell.get("data-append-csv"):
            continue
        pid = name_cell["data-append-csv"]
        team = cells["team_name_abbr"].get_text(strip=True)
        if "partial_table" in classes:
            # Per-team split of a traded player; rows are chronological, so
            # the last one is his current team.
            if pid in players:
                players[pid]["team"] = team
            continue
        players[pid] = {
            "player_id": pid,
            "name": name_cell.get_text(strip=True),
            "team": team,
            "pos": cells["pos"].get_text(strip=True),
            "g": _num(cells["games"].get_text()),
            **{col: _num(cells[stat].get_text()) for stat, col in STAT_MAP.items()},
        }
    return pd.DataFrame(players.values())


def day_box_scores(day: dt.date, cache_dir: Path | None = None) -> pd.DataFrame:
    """Every player box score line for one date (players who played only)."""
    url = f"{BASE}/friv/dailyleaders.fcgi?month={day.month}&day={day.day}&year={day.year}"
    # Only cache days that are safely over.
    cacheable = day < dt.date.today() - dt.timedelta(days=1)
    html = _get(url, cache_dir if cacheable else None, f"daily_{day.isoformat()}.html")
    try:
        rows = list(_rows(html, "stats"))
    except ValueError:
        return pd.DataFrame(columns=["player_id", "name", "team", "date", *STAT_COLS])
    out = []
    for classes, cells in rows:
        name_cell = cells.get("player")
        if name_cell is None or not name_cell.get("data-append-csv"):
            continue
        out.append({
            "player_id": name_cell["data-append-csv"],
            "name": name_cell.get_text(strip=True),
            "team": cells["team_id"].get_text(strip=True),
            "date": day.isoformat(),
            **{col: _num(cells[stat].get_text()) for stat, col in STAT_MAP.items()},
        })
    return pd.DataFrame(out)


def recent_totals(end: dt.date, days: int, cache_dir: Path | None = None) -> pd.DataFrame:
    """Totals over the `days` dates ending the day before `end`."""
    frames = [day_box_scores(end - dt.timedelta(days=i), cache_dir) for i in range(1, days + 1)]
    logs = pd.concat([f for f in frames if not f.empty], ignore_index=True) if any(
        not f.empty for f in frames) else pd.DataFrame(columns=["player_id", "name", "team", "date", *STAT_COLS])
    if logs.empty:
        return pd.DataFrame(columns=["player_id", "name", "team", "g", *STAT_COLS])
    logs = logs.sort_values("date")
    agg = logs.groupby("player_id").agg(
        name=("name", "last"), team=("team", "last"), g=("date", "nunique"),
        **{c: (c, "sum") for c in STAT_COLS},
    )
    return agg.reset_index()

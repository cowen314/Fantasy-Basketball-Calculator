"""Match my fantasy roster (hardcoded in my_team.json) to basketball-reference players.

my_team.json has "players" (active roster) and "il" (injured list). IL players
are on my team but left out of team totals.

Each roster entry is a player name ("Luka Doncic") or a basketball-reference
player id ("doncilu01"). Ids are useful when two players share a name.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
ID_RE = re.compile(r"^[a-z.'-]{1,7}\d{2}$")


def normalize(name: str) -> str:
    """Lowercase, strip accents, punctuation and generational suffixes."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[.'’`]", "", s)          # "D'Angelo" -> "dangelo", "P.J." -> "pj"
    s = re.sub(r"[^a-z0-9]+", " ", s)
    words = [w for w in s.split() if w not in SUFFIXES]
    return " ".join(words)


def load(path: Path) -> dict:
    """Read my_team.json. A missing file means no team."""
    if not path.exists():
        return {"name": "My team", "players": [], "il": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("name", "My team")
    data.setdefault("players", [])
    data.setdefault("il", [])
    return data


def match(entries: list[str], players: dict[str, str]) -> tuple[list[str], list[str]]:
    """Match roster entries to player ids.

    players maps player id -> display name. Returns (matched ids in roster
    order, entries that didn't match exactly one player).
    """
    by_name: dict[str, list[str]] = {}
    for pid, name in players.items():
        by_name.setdefault(normalize(name), []).append(pid)

    ids, problems = [], []
    for entry in entries:
        e = entry.strip()
        if e in players:
            ids.append(e)
            continue
        hits = by_name.get(normalize(e), [])
        if len(hits) == 1:
            ids.append(hits[0])
        elif hits:
            problems.append(f"{entry!r} matches {len(hits)} players ({', '.join(hits)}); use the id instead")
        else:
            problems.append(f"{entry!r} matches no player")
    return list(dict.fromkeys(ids)), problems

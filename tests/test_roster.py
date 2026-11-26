import json

from fbc.roster import load, match, normalize

PLAYERS = {
    "doncilu01": "Luka Dončić",
    "jacksja02": "Jaren Jackson Jr.",
    "russeda01": "D'Angelo Russell",
    "tuckepj01": "P.J. Tucker",
    "johnsja01": "Jalen Johnson",
    "johnsja05": "Jalen Johnson",
    "porteot01": "Otto Porter Jr.",
}


def test_normalize_strips_accents_suffixes_and_punctuation():
    assert normalize("Luka Dončić") == "luka doncic"
    assert normalize("Jaren Jackson Jr.") == "jaren jackson"
    assert normalize("Gary Trent Jr") == "gary trent"
    assert normalize("D'Angelo Russell") == "dangelo russell"
    assert normalize("P.J. Tucker") == "pj tucker"
    assert normalize("  KARL-ANTHONY  Towns ") == "karl anthony towns"


def test_match_by_name_variants():
    ids, problems = match(["luka doncic", "Jaren Jackson", "DAngelo Russell", "PJ Tucker",
                           "Otto Porter"], PLAYERS)
    assert ids == ["doncilu01", "jacksja02", "russeda01", "tuckepj01", "porteot01"]
    assert problems == []


def test_match_by_id_and_ambiguous_and_missing():
    ids, problems = match(["johnsja05", "Jalen Johnson", "Nobody Here"], PLAYERS)
    assert ids == ["johnsja05"]
    assert len(problems) == 2
    assert "matches 2 players" in problems[0]
    assert "matches no player" in problems[1]


def test_match_drops_duplicates():
    ids, _ = match(["Luka Doncic", "doncilu01"], PLAYERS)
    assert ids == ["doncilu01"]


def test_load_missing_and_present(tmp_path):
    assert load(tmp_path / "nope.json") == {"name": "My team", "players": []}
    p = tmp_path / "t.json"
    p.write_text(json.dumps({"players": ["Luka Doncic"]}))
    assert load(p) == {"name": "My team", "players": ["Luka Doncic"]}

# Fantasy Basketball Calculator

**Live page: https://cowen314.github.io/Fantasy-Basketball-Calculator/** (updated daily)

Daily z-score values for every NBA player in a head-to-head categories league, for quick waiver-wire lookups. The page shows three windows side by side: season to date, last 7 days, and the 2025-26 season. Each window has its per-category z-scores.

## How it works

- **z-score** per category = (per-game stat − pool mean) ÷ pool SD.
  - FG% / FT% are converted to impact = attempts × (player% − pool%) first, so volume counts.
  - Turnovers are negated.
- **Value** = sum of z-scores (per game). **Total** = value × games played.
- **Pool:** N = teams × roster spots. Score everyone, take the top N, recompute mean/SD over those N, and repeat until the top N stops changing. Players below a minimum games played (25% of the league leader's games) are left out of the pool.
- **Last 7 days** uses the season-to-date mean/SD, so it reads as "playing at this level lately".
- **2025-26** has its own full-season pool. It is computed once and stored in `data/static/`.

League settings are in `config.json`: teams, roster spots, categories, minimum games, window length, and the static season. The static season uses basketball-reference's year, where 2026 means 2025-26. If you change the settings, the static season is recomputed automatically.

## My team and trades

Your fantasy roster is hardcoded in `my_team.json` until Yahoo Fantasy is connected:

```json
{ "name": "My team", "players": ["Luka Doncic", "Jaren Jackson Jr."], "il": ["jacksja02"] }
```

`il` lists players on your injured list: they are starred and tradeable on the page, but left out of team totals.

Names are matched to basketball-reference ignoring case, accents, punctuation and suffixes like Jr./III. Use the basketball-reference id (from the player's URL) if two players share a name. The build prints a warning for anything it can't match, and the page shows it too.

On the page:
- Your players are starred and highlighted, and **My team only** filters to them.
- **My team** sums each category's per-game z-scores across the active roster (IL players left out) for each window, which shows the team's strengths and weaknesses.
- **Trade**: click ⇄ on any rows to build a trade (yours go on the give side, others on the get side). It shows the change to each category and to total value, per window.
- **Trade ideas** lists 1-for-1 swaps where the two players' values are within a set gap and the weighted category gain is positive. Categories are weighted by how weak your team is in them (weakest 1.75×, strongest 0.25×). Targets are "likely rostered" players by default, or everyone.
- **Punt** (under the page title): tick a category to drop it. Value, total, rank, team value and trade ideas then ignore it (weight 0), and its columns are dimmed. The z-scores and baseline pool stay the same, since the pool stands in for the league's rosters and the other managers aren't punting. For the same reason, the trade-idea value gap (fairness to the other manager) still uses every category. The choice is saved in your browser.

## Data source

Data comes from [basketball-reference.com](https://www.basketball-reference.com): the season totals pages, plus the daily box-score pages for the last 7 days. stats.nba.com blocks cloud and CI IP ranges, so it isn't used. One build makes about 9 requests, spaced 3.5 s apart to stay under basketball-reference's rate limit.

## Running locally

```bash
pip install -r requirements.txt
python -m fbc.build --cache-dir .cache   # writes site/data/players.json and players.csv
python -m http.server -d site 8000       # open http://localhost:8000
python -m pytest tests
node --test tests/*.test.js              # trade math
```

`--date YYYY-MM-DD` sets which day the build treats as today. `--rebuild-static` forces the prior season to be recomputed.

## Hosting (GitHub Pages)

`.github/workflows/update.yml` rebuilds the data daily at 11:17 UTC, on every push, and on demand. Runs on `main` then deploy `site/` to GitHub Pages; pushes to other branches only build and test. One-time setup: **Settings → Pages → Source: GitHub Actions**.

If basketball-reference ever blocks GitHub's runners, add a repository secret `HTTPS_PROXY` (e.g. `http://user:pass@host:port`) and the build will route through it.

## Not yet built

Live Yahoo rosters (trade targets are estimated for now), H2H matchup tuning, and schedule / playoff-week games.

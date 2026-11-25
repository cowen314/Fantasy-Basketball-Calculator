# Fantasy Basketball Calculator

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

## Data source

Data comes from [basketball-reference.com](https://www.basketball-reference.com): the season totals pages, plus the daily box-score pages for the last 7 days. stats.nba.com blocks cloud and CI IP ranges, so it isn't used. One build makes about 9 requests, spaced 3.5 s apart to stay under basketball-reference's rate limit.

## Running locally

```bash
pip install -r requirements.txt
python -m fbc.build --cache-dir .cache   # writes site/data/players.json and players.csv
python -m http.server -d site 8000       # open http://localhost:8000
python -m pytest tests
```

`--date YYYY-MM-DD` sets which day the build treats as today. `--rebuild-static` forces the prior season to be recomputed.

## Hosting (GitHub Pages)

`.github/workflows/update.yml` rebuilds the data daily at 11:17 UTC, on every push, and on demand. Runs on `main` then deploy `site/` to GitHub Pages; pushes to other branches only build and test. One-time setup: **Settings → Pages → Source: GitHub Actions**.

If basketball-reference ever blocks GitHub's runners, add a repository secret `HTTPS_PROXY` (e.g. `http://user:pass@host:port`) and the build will route through it.

## Not yet built

Trade comparisons against a waiver-level player, punting categories, H2H matchup tuning, and schedule / playoff-week games.

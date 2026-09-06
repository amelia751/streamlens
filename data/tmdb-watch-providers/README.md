# TMDB + JustWatch — watch providers and Netflix catalog

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [TMDB API](https://developer.themoviedb.org/) watch-provider + discover endpoints |
| **Watch providers** | Powered by JustWatch via TMDB |
| **Auth** | `secrets/tmdb.env` (`TMDB_READ_ACCESS_TOKEN`) |
| **Downloaded** | 2026-09-06 |

## What It Contains

Publicly observed availability — **not** Netflix ground truth.

| File | Description |
|------|-------------|
| `watch_regions.json` | Countries TMDB has provider data for |
| `watch_providers_movie.json` | Movie providers (Netflix is typically `provider_id` 8) |
| `watch_providers_tv.json` | TV providers |
| `netflix_us_movies.json` | US Netflix `flatrate` movie discover snapshot |
| `netflix_us_tv.json` | US Netflix `flatrate` TV discover snapshot |

Discover rows are TMDB list fields only (id, title, dates, popularity, votes, genres). Full credits/keywords/reviews are later title-level pulls.

## How to Reproduce

```bash
cd data/tmdb-watch-providers
python3 download.py
```

**Script:** `download.py`

Requires `secrets/tmdb.env`. Respects TMDB rate limits (~0.28s between calls). Never prints the token.

## Purpose

`catalog_availability_snapshot` backbone for **current** Netflix membership (start with US; other `watch_region`s are the same call). Snapshot repeatedly to get entered/left/days_available.

## Compliance Notes

- TMDB attribution required
- Label as **publicly observed availability** (JustWatch/TMDB sync can lag)
- Never commit or print TMDB credentials
- Do not ship TMDB payloads as a competing commercial catalog without checking TMDB terms

# MovieLens 32M

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [GroupLens — MovieLens 32M](https://grouplens.org/datasets/movielens/32m/) |
| **File** | `https://files.grouplens.org/datasets/movielens/ml-32m.zip` (~239 MB) |
| **License** | [MovieLens 32M README / usage license](https://files.grouplens.org/datasets/movielens/ml-32m-README.html) |
| **Collected** | 1995-01-09 through 2023-10-12 (generated 2023-10-13, released 2024-05) |
| **Downloaded** | 2026-09-06 |

## What It Contains

32,000,204 ratings and 2,000,072 free-text tag applications across 87,585 movies and 200,948 users.

| File | Description |
|------|-------------|
| `ratings.csv` | `userId,movieId,rating,timestamp` |
| `tags.csv` | `userId,movieId,tag,timestamp` |
| `movies.csv` | `movieId,title,genres` |
| `links.csv` | `movieId,imdbId,tmdbId` — join key to TMDB / IMDb |
| `ml-32m.zip` | Original archive |
| `README.txt` | Upstream license + schema |

This dump does **not** include Tag Genome scores. Those live in `data/movielens-tag-genome/`.

## How to Reproduce

```bash
cd data/movielens-32m
python3 download.py
```

**Script:** `download.py`

No API key. Downloads the zip and extracts the four CSVs plus the upstream README.

`files.grouplens.org` currently presents an expired TLS certificate. The script uses `curl -k` and you should confirm the extracted `README.txt` MD5 list against the files.

## Purpose

- Individual film ratings (a different population than TMDB or IMDb)
- Audience-applied tags (`slow burn`, `mind bending`, …)
- Clean `tmdbId` joins via `links.csv` — no fuzzy title match for movies

MovieLens is movies-only. Netflix TV uses TMDB reviews, IMDb, YouTube, and Netflix engagement instead.

## Compliance Notes

- Follow the GroupLens usage license (citation + non-redistribution terms in `README.txt`)
- Do not treat tags as long-form reviews
- Do not average MovieLens ratings with TMDB / IMDb
